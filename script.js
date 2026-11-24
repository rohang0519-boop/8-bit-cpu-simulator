
// ==========================================
// 8-BIT CPU SIMULATOR - JAVASCRIPT ENGINE
// C++ WEBASSEMBLY INTEGRATION
// ==========================================


// ==========================================
// C++ WEBASSEMBLY CONNECTION
// ==========================================

let wasmModule = null;
let wasmLoadingError = null;

const wasmReady = CPUModule()
    .then(module => {
        wasmModule = module;
        console.log("C++ CPU Engine loaded successfully.");
    })
    .catch(error => {
        wasmLoadingError = error;
        console.error("Failed to load C++ CPU Engine:", error);
    });


function wasmCall(name, returnType = "number", argTypes = [], args = []) {

    if (!wasmModule) {
        throw new Error(
            wasmLoadingError
                ? "C++ engine failed to load. Check the browser console."
                : "C++ engine is still loading. Please wait."
        );
    }

    return wasmModule.ccall(name, returnType, argTypes, args);
}


function getWasmError() {
    return wasmCall("cpu_get_error", "string") ||
        "Unknown C++ CPU error.";
}


function syncCPUFromWasm() {

    cpu.pc = wasmCall("cpu_get_pc");

    cpu.registers = [0, 1, 2, 3].map(index =>
        wasmCall("cpu_get_register", "number", ["number"], [index])
    );

    cpu.memory = Array.from({ length: 256 }, (_, address) =>
        wasmCall("cpu_get_memory", "number", ["number"], [address])
    );

    cpu.flags.zf = wasmCall("cpu_get_flag", "number", ["number"], [0]);
    cpu.flags.cf = wasmCall("cpu_get_flag", "number", ["number"], [1]);
    cpu.flags.sf = wasmCall("cpu_get_flag", "number", ["number"], [2]);
    cpu.flags.of = wasmCall("cpu_get_flag", "number", ["number"], [3]);

    cpu.halted = wasmCall("cpu_is_halted") === 1;

    cpu.instructionCount = wasmCall("cpu_get_instruction_count");
}



// ==========================================
// CPU STATE
// ==========================================

let cpu = {
    pc: 0,
    ir: "HLT",

    registers: [0, 0, 0, 0],
    memory: new Array(256).fill(0),

    flags: {
        zf: 0,
        cf: 0,
        sf: 0,
        of: 0
    },

    status: "READY",

    instructions: [],
    labels: {},

    halted: false,
    activeInstruction: null,

    registerChanges: [],
    memoryChanges: [],

    instructionCount: 0
};


let isExecuting = false;
let executionToken = 0;


// ==========================================
// ALU VISUALIZATION
// ==========================================

function updateALUView(operation, operandA, operandB, result, message) {

    const operationElement = document.getElementById("alu-operation");
    const operandAElement = document.getElementById("alu-a");
    const operandBElement = document.getElementById("alu-b");
    const resultElement = document.getElementById("alu-result");
    const messageElement = document.getElementById("alu-message");

    if (operationElement) operationElement.textContent = operation;
    if (operandAElement) operandAElement.textContent = operandA;
    if (operandBElement) operandBElement.textContent = operandB;
    if (resultElement) resultElement.textContent = result;
    if (messageElement) messageElement.textContent = message;
}


function resetALUView() {

    updateALUView(
        "IDLE",
        0,
        0,
        0,
        "Waiting for an ALU operation..."
    );
}


// ==========================================
// CPU INTERNAL BUS VISUALIZATION
// ==========================================

function resetBusView() {

    const componentIds = [
        "bus-registers",
        "internal-bus",
        "bus-alu",
        "bus-memory"
    ];

    componentIds.forEach(id => {

        const element = document.getElementById(id);
        if (!element) return;

        element.classList.remove("active");

        const status = element.querySelector(".bus-status");
        if (status) status.textContent = "IDLE";
    });

    const connectionIds = [
        "register-bus",
        "alu-bus-connection",
        "memory-bus-connection"
    ];

    connectionIds.forEach(id => {

        const element = document.getElementById(id);
        if (!element) return;

        element.classList.remove("active");

        element.querySelectorAll(".bus-line").forEach(line => {
            line.classList.remove("active");
        });
    });

    const busData = document.getElementById("bus-data");
    const busMessage = document.getElementById("bus-message");
    const addressValue = document.getElementById("address-bus-value");
    const dataValue = document.getElementById("data-bus-value");
    const controlValue = document.getElementById("control-bus-value");

    if (busData) busData.textContent = "No data transfer";
    if (busMessage) busMessage.textContent = "Waiting for data transfer...";
    if (addressValue) addressValue.textContent = "---";
    if (dataValue) dataValue.textContent = "---";
    if (controlValue) controlValue.textContent = "IDLE";
}


function updateBusView(source, destination, address, data, control, message) {

    resetBusView();

    const busData = document.getElementById("bus-data");
    const busMessage = document.getElementById("bus-message");

    const addressValue = document.getElementById("address-bus-value");
    const dataValue = document.getElementById("data-bus-value");
    const controlValue = document.getElementById("control-bus-value");

    if (busData) busData.textContent = data;
    if (busMessage) busMessage.textContent = message;
    if (addressValue) addressValue.textContent = address;
    if (dataValue) dataValue.textContent = data;
    if (controlValue) controlValue.textContent = control;

    const sourceElement = document.getElementById(source);
    const destinationElement = document.getElementById(destination);
    const internalBus = document.getElementById("internal-bus");

    if (sourceElement) {
        sourceElement.classList.add("active");

        const status = sourceElement.querySelector(".bus-status");
        if (status) status.textContent = "SENDING";
    }

    if (destinationElement) {
        destinationElement.classList.add("active");

        const status = destinationElement.querySelector(".bus-status");
        if (status) status.textContent = "RECEIVING";
    }

    if (internalBus) {
        internalBus.classList.add("active");

        const status = internalBus.querySelector(".bus-status");
        if (status) status.textContent = "ACTIVE";
    }

    const connectionIds = [
        "register-bus",
        "alu-bus-connection",
        "memory-bus-connection"
    ];

    connectionIds.forEach(id => {

        const element = document.getElementById(id);
        if (!element) return;

        const shouldActivate =
            (id === "register-bus" &&
                (source === "bus-registers" || destination === "bus-registers")) ||

            (id === "alu-bus-connection" &&
                (source === "bus-alu" || destination === "bus-alu")) ||

            (id === "memory-bus-connection" &&
                (source === "bus-memory" || destination === "bus-memory"));

        if (shouldActivate) {
            element.classList.add("active");

            element.querySelectorAll(".bus-line").forEach(line => {
                line.classList.add("active");
            });
        }
    });
}


// ==========================================
// REGISTER VALIDATION
// ==========================================

function getRegisterIndex(name) {

    const match = name.toUpperCase().match(/^R([0-3])$/);

    if (!match) {
        throw new Error("Invalid register: " + name);
    }

    return Number(match[1]);
}


// ==========================================
// MEMORY ADDRESS VALIDATION
// ==========================================

function getMemoryAddress(token) {

    token = token.trim();

    let address;

    if (/^R[0-3]$/i.test(token)) {
        address = cpu.registers[getRegisterIndex(token)];
    } else if (/^(0|[1-9]\d*)$/.test(token)) {
        address = Number(token);
    } else if (/^0x[0-9a-f]+$/i.test(token)) {
        address = parseInt(token, 16);
    } else {
        throw new Error("Invalid memory address: " + token);
    }

    if (!Number.isInteger(address) || address < 0 || address > 255) {
        throw new Error("Memory address must be between 0 and 255.");
    }

    return address;
}


// ==========================================
// BUS ACTIVITY FOR CPU INSTRUCTIONS
// ==========================================

function showBusActivity(
    opcode,
    a,
    b,
    previousRegisters,
    previousMemory,
    currentPC,
    nextPC
) {

    const registerBus = "bus-registers";
    const aluBus = "bus-alu";
    const memoryBus = "bus-memory";

    let source = registerBus;
    let destination = registerBus;

    let address = "---";
    let data = "---";
    let control = "IDLE";
    let message = "No bus transfer.";

    const getPreviousValue = token => {

        if (!token) return 0;

        if (/^R[0-3]$/i.test(token)) {
            return previousRegisters[getRegisterIndex(token)];
        }

        if (/^0x[0-9a-f]+$/i.test(token)) {
            return parseInt(token, 16);
        }

        return Number(token);
    };

    switch (opcode) {

        case "MOV": {

            const value = getPreviousValue(b);

            data = value;
            control = "REGISTER WRITE";

            message = "Moving value " + value +
                " into " + a.toUpperCase() + ".";

            break;
        }

        case "ADD":
        case "SUB":
        case "MUL":
        case "DIV":
        case "MOD":
        case "AND":
        case "OR":
        case "XOR":
        case "NOT":
        case "CMP": {

            const left = getPreviousValue(a);
            const right = opcode === "NOT" ? "—" : getPreviousValue(b);

            source = registerBus;
            destination = aluBus;

            data = "A: " + left + " | B: " + right;
            control = "ALU " + opcode;

            message = "Sending operands to the ALU for " +
                opcode + " operation.";

            break;
        }

        case "STORE": {

            const reg = getRegisterIndex(a);
            const memoryAddress = getMemoryAddress(b);
            const value = previousRegisters[reg];

            source = registerBus;
            destination = memoryBus;

            address = memoryAddress;
            data = value;
            control = "MEMORY WRITE";

            message = "Writing value " + value +
                " from " + a.toUpperCase() +
                " into RAM address " + memoryAddress + ".";

            break;
        }

        case "LOAD": {

            const memoryAddress = getMemoryAddress(b);
            const value = previousMemory[memoryAddress];

            source = memoryBus;
            destination = registerBus;

            address = memoryAddress;
            data = value;
            control = "MEMORY READ";

            message = "Reading value " + value +
                " from RAM address " + memoryAddress +
                " into " + a.toUpperCase() + ".";

            break;
        }

        case "JMP":
        case "JZ":
        case "JNZ":
        case "JC":
        case "JNC": {

            const taken = nextPC !== currentPC + 1;

            address = taken ? nextPC : "---";
            data = taken ? nextPC : "---";
            control = taken ? "BRANCH TAKEN" : "BRANCH NOT TAKEN";

            message = taken
                ? opcode + ": Control transferred to instruction " + nextPC + "."
                : opcode + ": Branch condition not satisfied.";

            source = registerBus;
            destination = "internal-bus";

            break;
        }

        case "HLT": {

            data = "—";
            control = "HALT";
            message = "CPU has stopped execution.";

            source = "internal-bus";
            destination = "internal-bus";

            break;
        }

        default:
            resetBusView();
            return;
    }

    updateBusView(
        source,
        destination,
        address,
        data,
        control,
        message
    );
}


// ==========================================
// CONTROL UNIT VISUALIZATION
// ==========================================

function resetControlUnitView() {

    const signalIds = [
        "signal-reg-read",
        "signal-reg-write",
        "signal-alu",
        "signal-mem-read",
        "signal-mem-write",
        "signal-flag-write",
        "signal-pc-update",
        "signal-branch",
        "signal-halt"
    ];

    signalIds.forEach(id => {

        const element = document.getElementById(id);
        if (!element) return;

        element.classList.remove("active");

        const status = element.querySelector("strong");
        if (status) status.textContent = "INACTIVE";
    });

    const instruction = document.getElementById("cu-instruction");
    const message = document.getElementById("cu-message");

    if (instruction) instruction.textContent = "WAITING";

    if (message) {
        message.textContent =
            "Waiting for an instruction to be decoded...";
    }
}


function updateControlUnit(opcode, a, b) {

    resetControlUnitView();

    const isRegister = value =>
        typeof value === "string" &&
        /^R[0-3]$/i.test(value);

    const signals = {
        regRead: false,
        regWrite: false,
        alu: false,
        memRead: false,
        memWrite: false,
        flagWrite: false,
        pcUpdate: true,
        branch: false,
        halt: false
    };

    const arithmeticInstructions = [
        "ADD", "SUB", "MUL", "DIV", "MOD",
        "AND", "OR", "XOR", "NOT"
    ];

    const jumpInstructions = [
        "JMP", "JZ", "JNZ", "JC", "JNC"
    ];

    switch (opcode) {

        case "MOV":
            signals.regRead = isRegister(b);
            signals.regWrite = true;
            break;

        case "ADD":
        case "SUB":
        case "MUL":
        case "DIV":
        case "MOD":
        case "AND":
        case "OR":
        case "XOR":
        case "NOT":
            signals.regRead = true;
            signals.regWrite = true;
            signals.alu = true;
            signals.flagWrite = true;
            break;

        case "CMP":
            signals.regRead = isRegister(a) || isRegister(b);
            signals.alu = true;
            signals.flagWrite = true;
            break;

        case "LOAD":
            signals.regWrite = true;
            signals.memRead = true;
            break;

        case "STORE":
            signals.regRead = true;
            signals.memWrite = true;
            break;

        case "JMP":
        case "JZ":
        case "JNZ":
        case "JC":
        case "JNC":
            signals.branch = true;
            break;

        case "HLT":
            signals.pcUpdate = false;
            signals.halt = true;
            break;
    }

    const signalMap = [
        ["signal-reg-read", signals.regRead],
        ["signal-reg-write", signals.regWrite],
        ["signal-alu", signals.alu],
        ["signal-mem-read", signals.memRead],
        ["signal-mem-write", signals.memWrite],
        ["signal-flag-write", signals.flagWrite],
        ["signal-pc-update", signals.pcUpdate],
        ["signal-branch", signals.branch],
        ["signal-halt", signals.halt]
    ];

    signalMap.forEach(([id, active]) => {

        const element = document.getElementById(id);
        if (!element) return;

        const status = element.querySelector("strong");

        if (active) {
            element.classList.add("active");
            if (status) status.textContent = "ACTIVE";
        }
    });

    const instructionElement =
        document.getElementById("cu-instruction");

    const messageElement =
        document.getElementById("cu-message");

    if (instructionElement) {
        instructionElement.textContent = opcode;
    }

    let message = "";

    if (opcode === "MOV") {
        message = "The Control Unit enables register data transfer.";
    } else if (arithmeticInstructions.includes(opcode) || opcode === "CMP") {
        message = "The Control Unit enables the ALU to perform " +
            opcode + " and updates the required flags.";
    } else if (opcode === "LOAD") {
        message = "The Control Unit enables RAM read and register write.";
    } else if (opcode === "STORE") {
        message = "The Control Unit enables register read and RAM write.";
    } else if (jumpInstructions.includes(opcode)) {
        message = "The Control Unit evaluates the branch instruction and controls the Program Counter.";
    } else if (opcode === "HLT") {
        message = "The Control Unit sends the HALT signal to stop CPU execution.";
    } else {
        message = "Control signals generated for instruction " + opcode + ".";
    }

    if (messageElement) {
        messageElement.textContent = message;
    }
}


// ==========================================
// CPU ARCHITECTURE ANIMATION
// ==========================================

function resetArchitectureView() {

    const components = [
        "arch-pc",
        "arch-ir",
        "arch-cu",
        "arch-registers",
        "arch-alu",
        "arch-memory"
    ];

    components.forEach(id => {

        const element = document.getElementById(id);

        if (element) {
            element.classList.remove("active");
        }
    });

    const message = document.getElementById("architecture-message");

    if (message) {
        message.textContent = "CPU architecture is waiting for execution.";
    }
}


function updateArchitectureView(opcode, a, b) {

    resetArchitectureView();

    const activate = id => {
        const element = document.getElementById(id);

        if (element) {
            element.classList.add("active");
        }
    };

    activate("arch-pc");
    activate("arch-ir");
    activate("arch-cu");

    let message = "Control Unit is processing " + opcode + ".";

    const aluInstructions = [
        "ADD", "SUB", "MUL", "DIV", "MOD",
        "AND", "OR", "XOR", "NOT", "CMP"
    ];

    const memoryInstructions = ["LOAD", "STORE"];

    const registerInstructions = [
        "MOV", ...aluInstructions, ...memoryInstructions
    ];

    if (registerInstructions.includes(opcode)) {
        activate("arch-registers");
    }

    if (aluInstructions.includes(opcode)) {
        activate("arch-alu");
        message = "Register data is being processed by the ALU.";
    }

    if (opcode === "LOAD") {
        activate("arch-memory");
        message = "RAM is sending data to the register bank.";
    }

    if (opcode === "STORE") {
        activate("arch-memory");
        message = "Register data is being written into RAM.";
    }

    if (opcode === "MOV") {
        message = "Data is being transferred between registers or an immediate value.";
    }

    if (["JMP", "JZ", "JNZ", "JC", "JNC"].includes(opcode)) {
        message = "The Control Unit is controlling the Program Counter.";
    }

    if (opcode === "HLT") {
        message = "The CPU has received the HALT instruction.";
    }

    const messageElement =
        document.getElementById("architecture-message");

    if (messageElement) {
        messageElement.textContent = message;
    }
}


// ==========================================
// FETCH-DECODE-EXECUTE CYCLE
// ==========================================

function cycleDelay() {

    const speedControl =
        document.getElementById("execution-speed");

    const delay = speedControl
        ? Number(speedControl.value)
        : 350;

    return new Promise(resolve => {
        setTimeout(resolve, delay);
    });
}


function updateCycleView(stage, message) {

    const stages = ["fetch", "decode", "execute"];
    const stageIndex = stages.indexOf(stage);

    stages.forEach((name, index) => {

        const element = document.getElementById(name + "-stage");
        if (!element) return;

        const status = element.querySelector(".stage-status");
        if (!status) return;

        element.classList.remove("active", "completed");

        if (stage === "complete") {

            element.classList.add("completed");
            status.textContent = "COMPLETED";

        } else if (stage === "error") {

            if (index === 2) {
                element.classList.add("active");
                status.textContent = "ERROR";
            } else {
                status.textContent = "WAITING";
            }

        } else if (stageIndex === -1) {

            status.textContent = "WAITING";

        } else if (index < stageIndex) {

            element.classList.add("completed");
            status.textContent = "COMPLETED";

        } else if (index === stageIndex) {

            element.classList.add("active");
            status.textContent = "ACTIVE";

        } else {

            status.textContent = "WAITING";
        }
    });

    const messageElement = document.getElementById("cycle-message");

    if (messageElement) {
        messageElement.textContent = message;
    }
}


function resetCycleView() {

    updateCycleView(
        "idle",
        "Waiting for CPU execution..."
    );
}


// ==========================================
// DASHBOARD UPDATE
// ==========================================

function updateDashboard() {

    const pcElement = document.getElementById("pc");
    const irElement = document.getElementById("ir");
    const statusElement = document.getElementById("cpu-status");

    if (pcElement) pcElement.textContent = cpu.pc;
    if (irElement) irElement.textContent = cpu.ir;
    if (statusElement) statusElement.textContent = cpu.status;

    // UPDATE INSTRUCTIONS EXECUTED COUNTER

    const instructionCounter =
        document.getElementById("stat-instructions");

    if (instructionCounter) {
        instructionCounter.textContent = cpu.instructionCount || 0;
    }

    for (let i = 0; i < 4; i++) {

        const registerElement = document.getElementById("r" + i);

        if (registerElement) {
            registerElement.textContent = cpu.registers[i];
        }

        const registerCard = registerElement
            ? registerElement.parentElement
            : null;

        const changeDisplay =
            document.getElementById("r" + i + "-change");

        const change = cpu.registerChanges.find(
            item => item.index === i
        );

        if (change) {

            if (registerCard) {
                registerCard.classList.add("changed");
            }

            if (changeDisplay) {
                changeDisplay.textContent =
                    change.oldValue + " → " + change.newValue;
            }

        } else {

            if (registerCard) {
                registerCard.classList.remove("changed");
            }

            if (changeDisplay) {
                changeDisplay.textContent = "";
            }
        }
    }

    const flagIds = ["zf", "cf", "sf", "of"];
    const flagValues = [
        cpu.flags.zf,
        cpu.flags.cf,
        cpu.flags.sf,
        cpu.flags.of
    ];

    flagIds.forEach((id, index) => {

        const element = document.getElementById(id);

        if (element) {
            element.textContent = flagValues[index];
        }
    });

    updateMemoryView();
    updateInstructionView();
}


// ==========================================
// INSTRUCTION DEBUGGER VIEW
// ==========================================

function updateInstructionView() {

    const view = document.getElementById("instruction-view");

    if (!view) return;

    view.innerHTML = "";

    if (cpu.instructions.length === 0) {
        view.textContent = "Load a program to view instructions.";
        return;
    }

    cpu.instructions.forEach((instruction, index) => {

        const row = document.createElement("div");

        row.className = "instruction-row";

        if (index === cpu.activeInstruction) {
            row.classList.add("active");
        }

        const number = document.createElement("span");

        number.className = "instruction-number";
        number.textContent = index;

        const text = document.createElement("span");

        text.className = "instruction-text";
        text.textContent = instruction;

        row.appendChild(number);
        row.appendChild(text);

        view.appendChild(row);
    });

    const activeRow = view.querySelector(".instruction-row.active");

    if (activeRow) {
        activeRow.scrollIntoView({
            block: "nearest",
            behavior: "smooth"
        });
    }
}


// ==========================================
// MEMORY VIEW WITH CHANGE TRACKING
// ==========================================

function updateMemoryView() {

    const memoryView = document.getElementById("memory-view");

    if (!memoryView) return;

    memoryView.innerHTML = "";

    for (let i = 0; i < 256; i++) {

        const cell = document.createElement("div");

        const change = cpu.memoryChanges.find(
            item => item.address === i
        );

        cell.className = change
            ? "memory-cell changed-memory"
            : "memory-cell";

        const address = document.createElement("div");

        address.className = "memory-address";
        address.textContent = "[" + i + "]";

        const value = document.createElement("div");

        value.className = "memory-value";
        value.textContent = cpu.memory[i];

        cell.appendChild(address);
        cell.appendChild(value);

        if (change) {

            const detail = document.createElement("small");

            detail.className = "memory-change";

            detail.textContent =
                change.oldValue + " → " + change.newValue;

            cell.appendChild(detail);
        }

        memoryView.appendChild(cell);
    }
}


// ==========================================
// EXECUTION LOG
// ==========================================

function addLog(message) {

    const log = document.getElementById("execution-log");

    if (!log) return;

    const entry = document.createElement("div");

    entry.textContent = message;

    log.appendChild(entry);

    log.scrollTop = log.scrollHeight;
}


// ==========================================
// LOAD AND PARSE PROGRAM
// ==========================================

function loadProgram() {

    if (!wasmModule) {
        throw new Error("C++ engine is not ready yet. Please wait.");
    }

    const inputElement = document.getElementById("assembly-code");

    if (!inputElement) {
        throw new Error("Assembly code input was not found.");
    }

    const input = inputElement.value;
    const lines = input.split("\n");

    cpu.instructions = [];
    cpu.labels = {};

    cpu.pc = 0;
    cpu.ir = "HLT";

    cpu.halted = false;
    cpu.activeInstruction = null;

    cpu.registerChanges = [];
    cpu.memoryChanges = [];

    for (let line of lines) {

        line = line.split(";")[0].trim();

        if (line === "") continue;

        const labelMatch = line.match(
            /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/
        );

        if (labelMatch) {

            const label = labelMatch[1].toUpperCase();
            const remaining = labelMatch[2].trim();

            if (
                Object.prototype.hasOwnProperty.call(
                    cpu.labels,
                    label
                )
            ) {
                throw new Error("Duplicate label: " + label);
            }

            cpu.labels[label] = cpu.instructions.length;

            line = remaining;

            if (line === "") continue;
        }

        cpu.instructions.push(line);
    }

    if (cpu.instructions.length === 0) {
        throw new Error("No instructions found.");
    }

    const success = wasmCall(
        "cpu_load_program",
        "number",
        ["string"],
        [input]
    );

    if (success !== 1) {
        throw new Error(getWasmError());
    }

    syncCPUFromWasm();

    cpu.status = "READY";

    resetCycleView();
    resetALUView();
    resetBusView();
    resetControlUnitView();
    resetArchitectureView();

    addLog("Program loaded successfully into C++ CPU engine.");
    addLog("Total instructions: " + cpu.instructions.length);

    updateDashboard();
}


// ==========================================
// EXECUTE ONE INSTRUCTION
// ==========================================

async function executeInstruction(token = executionToken) {

    if (cpu.halted || token !== executionToken) return;

    if (cpu.pc < 0 || cpu.pc >= cpu.instructions.length) {

        cpu.halted = true;
        cpu.status = "HALTED";

        addLog("Program completed.");
        updateDashboard();

        return;
    }

    try {

        const currentPC = cpu.pc;
        const instruction = cpu.instructions[currentPC];

        cpu.activeInstruction = currentPC;

        const previousRegisters = [...cpu.registers];
        const previousMemory = [...cpu.memory];

        const parts = instruction
            .replace(/,/g, " ")
            .trim()
            .split(/\s+/);

        const opcode = parts[0].toUpperCase();
        const a = parts[1] || "";
        const b = parts[2] || "";

        // FETCH

        cpu.status = "FETCHING";

        updateCycleView(
            "fetch",
            "FETCH: Retrieving instruction at address " + currentPC
        );

        updateDashboard();

        await cycleDelay();

        if (token !== executionToken) return;

        cpu.ir = instruction;

        addLog("FETCH: " + instruction);

        // DECODE

        cpu.status = "DECODING";

        updateCycleView(
            "decode",
            "DECODE: Identifying instruction and operands: " + instruction
        );

        updateDashboard();

        updateControlUnit(opcode, a, b);
        updateArchitectureView(opcode, a, b);

        resetALUView();

        addLog("DECODE: Operation identified as " + opcode);

        await cycleDelay();

        if (token !== executionToken) return;

        // EXECUTE USING C++ WEBASSEMBLY

        cpu.status = "EXECUTING";

        updateCycleView(
            "execute",
            "EXECUTE: C++ CPU engine is performing " + opcode
        );

        updateDashboard();

        await cycleDelay();

        if (token !== executionToken) return;

        addLog("EXECUTING IN C++: " + instruction);

        const result = wasmCall("cpu_step");

        if (result === -1) {
            throw new Error(getWasmError());
        }

        syncCPUFromWasm();

        cpu.ir = instruction;

        const nextPC = cpu.pc;

        if (cpu.pc >= cpu.instructions.length) {
            cpu.halted = true;
        }

        // ALU VISUALIZATION

        if ([
            "ADD", "SUB", "MUL", "DIV", "MOD",
            "AND", "OR", "XOR", "NOT", "CMP"
        ].includes(opcode)) {

            const getOldValue = value => {

                if (/^R[0-3]$/i.test(value)) {
                    return previousRegisters[getRegisterIndex(value)];
                }

                if (/^0x[0-9a-f]+$/i.test(value)) {
                    return parseInt(value, 16);
                }

                return Number(value);
            };

            const left = getOldValue(a);
            const right = opcode === "NOT" ? "—" : getOldValue(b);

            let resultValue = "—";

            if (opcode !== "CMP") {
                const registerIndex = getRegisterIndex(a);
                resultValue = cpu.registers[registerIndex];
            } else {
                resultValue = (left - right) & 255;
            }

            updateALUView(
                opcode,
                left,
                right,
                resultValue,
                opcode + " executed by the C++ ALU."
            );
        }

        // BUS VISUALIZATION

        showBusActivity(
            opcode,
            a,
            b,
            previousRegisters,
            previousMemory,
            currentPC,
            nextPC
        );

        // REGISTER CHANGE TRACKING

        cpu.registerChanges = [];

        for (let i = 0; i < 4; i++) {

            if (previousRegisters[i] !== cpu.registers[i]) {

                cpu.registerChanges.push({
                    index: i,
                    oldValue: previousRegisters[i],
                    newValue: cpu.registers[i]
                });
            }
        }

        // MEMORY CHANGE TRACKING

        cpu.memoryChanges = [];

        for (let i = 0; i < 256; i++) {

            if (previousMemory[i] !== cpu.memory[i]) {

                cpu.memoryChanges.push({
                    address: i,
                    oldValue: previousMemory[i],
                    newValue: cpu.memory[i]
                });
            }
        }

        // UPDATE CPU STATUS

        if (cpu.halted) {

            cpu.status = "HALTED";
            addLog("CPU execution completed.");

        } else {

            cpu.status = "RUNNING";
        }

        updateDashboard();

        updateCycleView(
            "complete",
            "C++ instruction executed successfully. CPU state synchronized."
        );

        addLog("Execution cycle completed.");

    } catch (error) {

        if (token !== executionToken) return;

        cpu.halted = true;
        cpu.status = "ERROR";

        updateCycleView(
            "error",
            "Execution failed: " + error.message
        );

        addLog("ERROR: " + error.message);

        updateDashboard();
    }
}


// ==========================================
// RUN PROGRAM
// ==========================================

async function runProgram() {

    if (isExecuting) return;

    isExecuting = true;

    const token = executionToken;

    try {

        await wasmReady;

        if (!wasmModule) {
            throw new Error("C++ engine could not be loaded.");
        }

        if (cpu.status === "HALTED" && cpu.instructions.length > 0) {

            addLog("Program has already finished. Press Reset to run again.");
            return;
        }

        if (cpu.instructions.length === 0) {
            loadProgram();
        }

        cpu.status = "RUNNING";
        updateDashboard();

        let safety = 0;

        while (
            !cpu.halted &&
            safety < 1000 &&
            token === executionToken
        ) {

            await executeInstruction(token);

            safety++;
        }

        if (
            safety >= 1000 &&
            !cpu.halted &&
            token === executionToken
        ) {

            cpu.halted = true;
            cpu.status = "ERROR";

            updateCycleView(
                "error",
                "Execution stopped: instruction limit reached."
            );

            addLog("Execution stopped: instruction limit reached.");
        }

        if (token === executionToken) {
            updateDashboard();
        }

    } catch (error) {

        if (token !== executionToken) return;

        cpu.halted = true;
        cpu.status = "ERROR";

        updateCycleView(
            "error",
            "Execution failed: " + error.message
        );

        addLog("ERROR: " + error.message);

        updateDashboard();

    } finally {

        if (token === executionToken) {
            isExecuting = false;
        }
    }
}


// ==========================================
// STEP PROGRAM
// ==========================================

async function stepProgram() {

    if (isExecuting) return;

    isExecuting = true;

    const token = executionToken;

    try {

        await wasmReady;

        if (!wasmModule) {
            throw new Error("C++ engine could not be loaded.");
        }

        if (cpu.halted) {
            addLog("CPU is halted. Press Reset to start again.");
            return;
        }

        if (cpu.instructions.length === 0) {
            loadProgram();
        }

        await executeInstruction(token);

    } catch (error) {

        if (token !== executionToken) return;

        cpu.halted = true;
        cpu.status = "ERROR";

        updateCycleView(
            "error",
            "Execution failed: " + error.message
        );

        addLog("ERROR: " + error.message);

        updateDashboard();

    } finally {

        if (token === executionToken) {
            isExecuting = false;
        }
    }
}


// ==========================================
// RESET CPU
// ==========================================

function resetCPU() {

    executionToken++;

    isExecuting = false;

    if (wasmModule) {
        wasmCall("cpu_reset");
    }

    cpu = {

        pc: 0,
        ir: "HLT",

        registers: [0, 0, 0, 0],

        memory: new Array(256).fill(0),

        flags: {
            zf: 0,
            cf: 0,
            sf: 0,
            of: 0
        },

        status: "READY",

        instructions: [],
        labels: {},

        halted: false,
        activeInstruction: null,

        registerChanges: [],
        memoryChanges: [],

        instructionCount: 0
    };

    const log = document.getElementById("execution-log");

    if (log) {
        log.innerHTML = "";
    }

    resetCycleView();
    resetALUView();
    resetBusView();
    resetControlUnitView();
    resetArchitectureView();

    addLog("C++ CPU engine reset successfully.");

    updateDashboard();
}


// ==========================================
// BUTTON EVENTS
// ==========================================

document.getElementById("run-btn")
    .addEventListener("click", runProgram);

document.getElementById("step-btn")
    .addEventListener("click", stepProgram);

document.getElementById("reset-btn")
    .addEventListener("click", resetCPU);


// ==========================================
// INITIALIZE DASHBOARD
// ==========================================

resetCycleView();
resetALUView();
resetBusView();
resetControlUnitView();
resetArchitectureView();

updateDashboard();

addLog("CPU Simulator initialized.");
