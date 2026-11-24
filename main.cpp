
#include <emscripten/emscripten.h>

#include <iostream>
#include <vector>
#include <array>
#include <string>
#include <sstream>
#include <algorithm>
#include <cstdint>
#include <map>
#include <cctype>
#include <cstdlib>

// ==========================================
// 8-BIT CPU SIMULATOR - C++ WEBASSEMBLY ENGINE
// ==========================================


// ==========================================
// OPCODES
// ==========================================

enum Opcode {
    MOV, ADD, SUB, MUL, DIV, MOD,
    AND, OR, XOR, NOT,
    LOAD, STORE,
    CMP,
    JMP, JZ, JNZ, JC, JNC,
    HLT
};


// ==========================================
// INSTRUCTION STRUCTURE
// ==========================================

struct Instruction {
    Opcode op = HLT;
    int a = 0;
    int b = 0;
    bool bIsRegister = false;
};


// ==========================================
// CPU STRUCTURE
// ==========================================

struct CPU {
    std::array<uint8_t, 4> R{};
    std::array<uint8_t, 256> RAM{};

    unsigned int PC = 0;
    Instruction IR{HLT, 0, 0, false};

    bool ZF = false;
    bool CF = false;
    bool SF = false;
    bool OF = false;

    bool halted = false;
    int instructionCount = 0;
};


// ==========================================
// GLOBAL CPU STATE
// ==========================================

CPU cpu;

std::vector<Instruction> program;
std::string errorMessage;
std::string currentInstruction;


// ==========================================
// HELPER FUNCTIONS
// ==========================================

std::string trim(const std::string& text) {

    size_t start = text.find_first_not_of(" \t\r\n");

    if (start == std::string::npos)
        return "";

    size_t end = text.find_last_not_of(" \t\r\n");

    return text.substr(start, end - start + 1);
}


std::string uppercase(std::string text) {

    std::transform(
        text.begin(),
        text.end(),
        text.begin(),
        [](unsigned char c) {
            return static_cast<char>(std::toupper(c));
        }
    );

    return text;
}


int parseRegister(const std::string& text) {

    std::string value = uppercase(trim(text));

    if (value.length() == 2 &&
        value[0] == 'R' &&
        value[1] >= '0' &&
        value[1] <= '3') {

        return value[1] - '0';
    }

    return -1;
}


bool parseNumber(const std::string& text, int& result) {

    std::string value = trim(text);

    if (value.empty())
        return false;

    char* end = nullptr;

    long number = std::strtol(value.c_str(), &end, 0);

    if (end == value.c_str() || *end != '\0')
        return false;

    if (number < 0 || number > 255)
        return false;

    result = static_cast<int>(number);

    return true;
}


// ==========================================
// RESET CPU
// ==========================================

void resetCPUState() {

    cpu.R.fill(0);
    cpu.RAM.fill(0);

    cpu.PC = 0;
    cpu.IR = {HLT, 0, 0, false};

    cpu.ZF = false;
    cpu.CF = false;
    cpu.SF = false;
    cpu.OF = false;

    cpu.halted = false;
    cpu.instructionCount = 0;

    currentInstruction.clear();
}


// ==========================================
// FLAG HELPERS
// ==========================================

void updateZeroSignFlags(uint8_t result) {

    cpu.ZF = (result == 0);
    cpu.SF = ((result & 0x80) != 0);
}


void updateAddFlags(uint8_t a, uint8_t b, uint16_t result) {

    uint8_t output = static_cast<uint8_t>(result);

    cpu.CF = (result > 255);

    cpu.OF = (
        ((~(a ^ b)) & (a ^ output) & 0x80) != 0
    );

    updateZeroSignFlags(output);
}


void updateSubFlags(uint8_t a, uint8_t b, uint8_t result) {

    cpu.CF = (a < b);

    cpu.OF = (
        (((a ^ b) & (a ^ result) & 0x80) != 0)
    );

    updateZeroSignFlags(result);
}


// ==========================================
// ALU
// ==========================================

uint8_t ALU(Opcode operation, uint8_t a, uint8_t b) {

    uint16_t wideResult = 0;
    uint8_t result = 0;

    switch (operation) {

        case ADD:

            wideResult = static_cast<uint16_t>(a) + b;
            result = static_cast<uint8_t>(wideResult);

            updateAddFlags(a, b, wideResult);

            break;


        case SUB:

            result = static_cast<uint8_t>(a - b);

            updateSubFlags(a, b, result);

            break;


        case MUL: {

            wideResult = static_cast<uint16_t>(a) * b;

            result = static_cast<uint8_t>(wideResult);

            cpu.CF = (wideResult > 255);

            int signedA = (a >= 128) ? a - 256 : a;
            int signedB = (b >= 128) ? b - 256 : b;

            int signedResult = signedA * signedB;

            cpu.OF = (
                signedResult < -128 ||
                signedResult > 127
            );

            updateZeroSignFlags(result);

            break;
        }


        case DIV:

            if (b == 0) {
                errorMessage = "Division by zero!";
                cpu.halted = true;
                return 0;
            }

            result = a / b;

            cpu.CF = false;
            cpu.OF = false;

            updateZeroSignFlags(result);

            break;


        case MOD:

            if (b == 0) {
                errorMessage = "Modulo by zero!";
                cpu.halted = true;
                return 0;
            }

            result = a % b;

            cpu.CF = false;
            cpu.OF = false;

            updateZeroSignFlags(result);

            break;


        case AND:

            result = a & b;

            cpu.CF = false;
            cpu.OF = false;

            updateZeroSignFlags(result);

            break;


        case OR:

            result = a | b;

            cpu.CF = false;
            cpu.OF = false;

            updateZeroSignFlags(result);

            break;


        case XOR:

            result = a ^ b;

            cpu.CF = false;
            cpu.OF = false;

            updateZeroSignFlags(result);

            break;


        case NOT:

            result = static_cast<uint8_t>(~a);

            cpu.CF = false;
            cpu.OF = false;

            updateZeroSignFlags(result);

            break;


        default:

            break;
    }

    return result;
}


// ==========================================
// INSTRUCTION PARSER
// ==========================================

bool parseProgram(
    const char* source,
    std::vector<Instruction>& output
) {

    output.clear();
    errorMessage.clear();

    if (source == nullptr) {
        errorMessage = "No assembly program provided.";
        return false;
    }

    std::stringstream input(source);

    std::string line;

    std::vector<std::string> instructions;

    std::map<std::string, int> labels;


    // --------------------------------------
    // FIRST PASS: FIND LABELS
    // --------------------------------------

    while (std::getline(input, line)) {

        size_t comment = line.find(';');

        if (comment != std::string::npos)
            line = line.substr(0, comment);

        line = trim(line);

        if (line.empty())
            continue;

        size_t colon = line.find(':');

        if (colon != std::string::npos) {

            std::string label = uppercase(
                trim(line.substr(0, colon))
            );

            if (label.empty()) {
                errorMessage = "Empty label found.";
                return false;
            }

            if (labels.count(label)) {
                errorMessage = "Duplicate label: " + label;
                return false;
            }

            labels[label] = static_cast<int>(instructions.size());

            line = trim(line.substr(colon + 1));

            if (line.empty())
                continue;
        }

        instructions.push_back(line);
    }


    // --------------------------------------
    // SECOND PASS: PARSE INSTRUCTIONS
    // --------------------------------------

    for (size_t lineNumber = 0;
         lineNumber < instructions.size();
         lineNumber++) {

        std::string instructionLine = trim(
            instructions[lineNumber]
        );

        std::replace(
            instructionLine.begin(),
            instructionLine.end(),
            ',',
            ' '
        );

        std::stringstream parser(instructionLine);

        std::string operation;

        std::string operandA;
        std::string operandB;

        parser >> operation;

        operation = uppercase(operation);

        parser >> operandA;

        parser >> operandB;


        Instruction inst;


        // ----------------------------------
        // HLT
        // ----------------------------------

        if (operation == "HLT") {

            inst.op = HLT;
        }


        // ----------------------------------
        // MOV
        // ----------------------------------

        else if (operation == "MOV") {

            int reg = parseRegister(operandA);

            if (reg == -1 || operandB.empty()) {
                errorMessage = "Invalid MOV instruction.";
                return false;
            }

            inst.op = MOV;
            inst.a = reg;

            int sourceRegister = parseRegister(operandB);

            if (sourceRegister != -1) {

                inst.b = sourceRegister;
                inst.bIsRegister = true;

            } else {

                if (!parseNumber(operandB, inst.b)) {
                    errorMessage = "Invalid MOV operand.";
                    return false;
                }
            }
        }


        // ----------------------------------
        // ARITHMETIC AND LOGIC INSTRUCTIONS
        // ----------------------------------

        else if (
            operation == "ADD" ||
            operation == "SUB" ||
            operation == "MUL" ||
            operation == "DIV" ||
            operation == "MOD" ||
            operation == "AND" ||
            operation == "OR"  ||
            operation == "XOR" ||
            operation == "CMP"
        ) {

            int reg = parseRegister(operandA);

            if (reg == -1 || operandB.empty()) {
                errorMessage = "Invalid " + operation + " instruction.";
                return false;
            }

            if (operation == "ADD") inst.op = ADD;
            if (operation == "SUB") inst.op = SUB;
            if (operation == "MUL") inst.op = MUL;
            if (operation == "DIV") inst.op = DIV;
            if (operation == "MOD") inst.op = MOD;
            if (operation == "AND") inst.op = AND;
            if (operation == "OR")  inst.op = OR;
            if (operation == "XOR") inst.op = XOR;
            if (operation == "CMP") inst.op = CMP;

            inst.a = reg;

            int sourceRegister = parseRegister(operandB);

            if (sourceRegister != -1) {

                inst.b = sourceRegister;
                inst.bIsRegister = true;

            } else {

                if (!parseNumber(operandB, inst.b)) {
                    errorMessage = "Invalid " + operation + " operand.";
                    return false;
                }
            }
        }


        // ----------------------------------
        // NOT
        // ----------------------------------

        else if (operation == "NOT") {

            int reg = parseRegister(operandA);

            if (reg == -1) {
                errorMessage = "Invalid NOT instruction.";
                return false;
            }

            inst.op = NOT;
            inst.a = reg;
        }


        // ----------------------------------
        // LOAD AND STORE
        // ----------------------------------

        else if (
            operation == "LOAD" ||
            operation == "STORE"
        ) {

            int reg = parseRegister(operandA);

            int address = 0;

            if (reg == -1 ||
                !parseNumber(operandB, address)) {

                errorMessage = "Invalid " + operation + " instruction.";
                return false;
            }

            inst.op = (operation == "LOAD") ? LOAD : STORE;

            inst.a = reg;
            inst.b = address;
        }


        // ----------------------------------
        // JUMP INSTRUCTIONS
        // ----------------------------------

        else if (
            operation == "JMP" ||
            operation == "JZ"  ||
            operation == "JNZ" ||
            operation == "JC"  ||
            operation == "JNC"
        ) {

            if (operandA.empty()) {
                errorMessage = "Missing jump target.";
                return false;
            }

            std::string target = uppercase(operandA);

            int address = -1;

            auto label = labels.find(target);

            if (label != labels.end()) {

                address = label->second;

            } else {

                if (!parseNumber(target, address)) {
                    errorMessage = "Unknown jump target: " + target;
                    return false;
                }
            }

            if (address > static_cast<int>(instructions.size())) {
                errorMessage = "Jump target is outside the program.";
                return false;
            }

            if (operation == "JMP") inst.op = JMP;
            if (operation == "JZ")  inst.op = JZ;
            if (operation == "JNZ") inst.op = JNZ;
            if (operation == "JC")  inst.op = JC;
            if (operation == "JNC") inst.op = JNC;

            inst.a = address;
        }


        // ----------------------------------
        // UNKNOWN INSTRUCTION
        // ----------------------------------

        else {

            errorMessage = "Unknown instruction: " + operation;
            return false;
        }


        output.push_back(inst);
    }


    if (output.empty()) {
        errorMessage = "Assembly program is empty.";
        return false;
    }

    return true;
}


// ==========================================
// FETCH
// ==========================================

bool fetch() {

    if (cpu.PC >= program.size()) {

        cpu.halted = true;
        return false;
    }

    cpu.IR = program[cpu.PC];

    cpu.PC++;

    return true;
}


// ==========================================
// EXECUTE
// ==========================================

void execute() {

    Instruction inst = cpu.IR;

    uint8_t a = cpu.R[inst.a];

    uint8_t b = inst.bIsRegister
        ? cpu.R[inst.b]
        : static_cast<uint8_t>(inst.b);


    switch (inst.op) {

        case MOV:

            cpu.R[inst.a] = b;

            break;


        case ADD:
        case SUB:
        case MUL:
        case DIV:
        case MOD:
        case AND:
        case OR:
        case XOR:

            cpu.R[inst.a] = ALU(inst.op, a, b);

            break;


        case NOT:

            cpu.R[inst.a] = ALU(NOT, a, 0);

            break;


        case LOAD:

            cpu.R[inst.a] = cpu.RAM[inst.b];

            break;


        case STORE:

            cpu.RAM[inst.b] = cpu.R[inst.a];

            break;


        case CMP: {

            uint8_t result = static_cast<uint8_t>(a - b);

            updateSubFlags(a, b, result);

            break;
        }


        case JMP:

            cpu.PC = inst.a;

            break;


        case JZ:

            if (cpu.ZF)
                cpu.PC = inst.a;

            break;


        case JNZ:

            if (!cpu.ZF)
                cpu.PC = inst.a;

            break;


        case JC:

            if (cpu.CF)
                cpu.PC = inst.a;

            break;


        case JNC:

            if (!cpu.CF)
                cpu.PC = inst.a;

            break;


        case HLT:

            cpu.halted = true;

            break;
    }
}


// ==========================================
// STEP CPU
// ==========================================

int stepCPU() {

    if (!errorMessage.empty())
        return -1;

    if (cpu.halted)
        return 0;

    if (!fetch())
        return 0;

    cpu.instructionCount++;

    execute();

    if (!errorMessage.empty())
        return -1;

    return 1;
}


// ==========================================
// RUN CPU
// ==========================================

int runCPU() {

    int result = 1;

    const int MAX_INSTRUCTIONS = 100000;

    int executed = 0;

    while (!cpu.halted && executed < MAX_INSTRUCTIONS) {

        result = stepCPU();

        if (result <= 0)
            return result;

        executed++;
    }

    if (executed >= MAX_INSTRUCTIONS && !cpu.halted) {

        errorMessage = "Execution limit reached. Possible infinite loop.";

        cpu.halted = true;

        return -1;
    }

    return 1;
}


// ==========================================
// WEBASSEMBLY EXPORTED FUNCTIONS
// ==========================================


// Load assembly program

extern "C" {

EMSCRIPTEN_KEEPALIVE
int cpu_load_program(const char* source) {

    errorMessage.clear();

    std::vector<Instruction> newProgram;

    if (!parseProgram(source, newProgram)) {
        program.clear();
        resetCPUState();
        return 0;
    }

    program = newProgram;

    resetCPUState();

    return 1;
}


// Execute one instruction

EMSCRIPTEN_KEEPALIVE
int cpu_step() {

    return stepCPU();
}


// Execute entire program

EMSCRIPTEN_KEEPALIVE
int cpu_run() {

    return runCPU();
}


// Reset CPU without deleting loaded program

EMSCRIPTEN_KEEPALIVE
void cpu_reset() {

    errorMessage.clear();

    resetCPUState();
}


// Get program counter

EMSCRIPTEN_KEEPALIVE
int cpu_get_pc() {

    return static_cast<int>(cpu.PC);
}


// Get current instruction opcode

EMSCRIPTEN_KEEPALIVE
int cpu_get_ir_opcode() {

    return static_cast<int>(cpu.IR.op);
}


// Get current instruction operand A

EMSCRIPTEN_KEEPALIVE
int cpu_get_ir_a() {

    return cpu.IR.a;
}


// Get current instruction operand B

EMSCRIPTEN_KEEPALIVE
int cpu_get_ir_b() {

    return cpu.IR.b;
}


// Get register value

EMSCRIPTEN_KEEPALIVE
int cpu_get_register(int index) {

    if (index < 0 || index >= 4)
        return -1;

    return cpu.R[index];
}


// Get RAM value

EMSCRIPTEN_KEEPALIVE
int cpu_get_memory(int address) {

    if (address < 0 || address >= 256)
        return -1;

    return cpu.RAM[address];
}


// Get CPU flags
// 0 = ZF, 1 = CF, 2 = SF, 3 = OF

EMSCRIPTEN_KEEPALIVE
int cpu_get_flag(int index) {

    switch (index) {

        case 0: return cpu.ZF;
        case 1: return cpu.CF;
        case 2: return cpu.SF;
        case 3: return cpu.OF;

        default: return -1;
    }
}


// Check whether CPU has halted

EMSCRIPTEN_KEEPALIVE
int cpu_is_halted() {

    return cpu.halted ? 1 : 0;
}


// Get executed instruction count

EMSCRIPTEN_KEEPALIVE
int cpu_get_instruction_count() {

    return cpu.instructionCount;
}


// Get error message

EMSCRIPTEN_KEEPALIVE
const char* cpu_get_error() {

    return errorMessage.c_str();
}

}
