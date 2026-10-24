const TICK_MS = 1000;
const ROAD_LENGTH = 100;
const STOP_LINE = 35;
const VEHICLE_SPEED = 5;
const CAR_GAP = 8;

const MIN_GREEN = 5;
const MAX_GREEN = 15;
const ALL_RED_SECONDS = 1;

let currentPhase = "NS";
let transition = "GREEN";
let phaseSeconds = 0;
let transitionSeconds = 0;

let vehicles = [];
let signals = {
    North: "GREEN",
    South: "GREEN",
    East: "RED",
    West: "RED"
};

let vehicleId = 0;
let simulationInterval = null;
let animationFrame = null;
let lastFrameTime = 0;

// Always alternate between the two axes.
function chooseNextPhase() {
    return currentPhase === "NS" ? "EW" : "NS";
}

// Update signals and manage the green/all-red phases.
function updateSignals(counts) {
    if (transition === "GREEN") {
        phaseSeconds++;

        const ns = currentPhase === "NS";

        const active = ns
            ? counts.North + counts.South
            : counts.East + counts.West;

        const waiting = ns
            ? counts.East + counts.West
            : counts.North + counts.South;

        // Switch at maximum green, or earlier if the other axis
        // has more demand after minimum green has elapsed.
        if (
            phaseSeconds >= MAX_GREEN ||
            (phaseSeconds >= MIN_GREEN && waiting > active)
        ) {
            transition = "ALL_RED";
            transitionSeconds = 0;
        }
    } else if (transition === "ALL_RED") {
        transitionSeconds++;

        if (transitionSeconds >= ALL_RED_SECONDS) {
            currentPhase = chooseNextPhase();
            transition = "GREEN";
            phaseSeconds = 0;
            transitionSeconds = 0;
        }
    }

    // During clearance, ALL four signals remain red.
    if (transition === "GREEN") {
        signals = currentPhase === "NS"
            ? {
                North: "GREEN",
                South: "GREEN",
                East: "RED",
                West: "RED"
            }
            : {
                North: "RED",
                South: "RED",
                East: "GREEN",
                West: "GREEN"
            };
    } else {
        signals = {
            North: "RED",
            South: "RED",
            East: "RED",
            West: "RED"
        };
    }
}

// Count vehicles on each approach.
function currentCounts() {
    const counts = {
        North: 0,
        South: 0,
        East: 0,
        West: 0
    };

    vehicles.forEach(vehicle => {
        counts[vehicle.direction]++;
    });

    return counts;
}

// Count vehicles waiting at the stop line.
function currentQueues() {
    const queues = {
        North: 0,
        South: 0,
        East: 0,
        West: 0
    };

    vehicles.forEach(vehicle => {
        const atStopLine = vehicle.direction === "North" ||
            vehicle.direction === "South"
            ? vehicle.position <= STOP_LINE
            : vehicle.position <= STOP_LINE;

        if (atStopLine && vehicle.stopped) {
            queues[vehicle.direction]++;
        }
    });

    return queues;
}

// Add a vehicle to the selected road.
function addVehicle(direction) {
    const roadVehicles = vehicles.filter(
        vehicle => vehicle.direction === direction
    );

    // Keep enough space between newly added vehicles.
    const hasSpace = roadVehicles.every(
        vehicle => vehicle.position > CAR_GAP
    );

    if (!hasSpace) return;

    vehicles.push({
        id: ++vehicleId,
        direction,
        position: 0,
        stopped: false
    });
}

// Move vehicles according to signal state and spacing.
function moveVehicles() {
    const directions = ["North", "South", "East", "West"];

    directions.forEach(direction => {
        const roadVehicles = vehicles
            .filter(vehicle => vehicle.direction === direction)
            .sort((a, b) => b.position - a.position);

        roadVehicles.forEach((vehicle, index) => {
            const vehicleAhead = roadVehicles[index - 1];

            let nextPosition = vehicle.position + VEHICLE_SPEED;

            // Do not let vehicles overlap.
            if (
                vehicleAhead &&
                nextPosition > vehicleAhead.position - CAR_GAP
            ) {
                nextPosition = vehicleAhead.position - CAR_GAP;
            }

            // Stop at the stop line when the light is red.
            if (
                signals[direction] !== "GREEN" &&
                vehicle.position < STOP_LINE &&
                nextPosition >= STOP_LINE
            ) {
                nextPosition = STOP_LINE;
            }

            // Vehicles already at the stop line cannot cross red.
            if (
                signals[direction] !== "GREEN" &&
                vehicle.position >= STOP_LINE
            ) {
                nextPosition = vehicle.position;
            }

            vehicle.position = nextPosition;
            vehicle.stopped = (
                signals[direction] !== "GREEN" &&
                vehicle.position >= STOP_LINE
            );
        });
    });

    // Remove vehicles that have left the road.
    vehicles = vehicles.filter(
        vehicle => vehicle.position < ROAD_LENGTH
    );
}

// Advance the simulation by one second.
function advanceSimulation() {
    const counts = currentCounts();

    updateSignals(counts);
    moveVehicles();

    // Refresh the interface if the project defines this function.
    if (typeof renderSimulation === "function") {
        renderSimulation();
    }
}

// Start the simulation timer.
function startSimulation() {
    if (simulationInterval !== null) return;

    simulationInterval = setInterval(
        advanceSimulation,
        TICK_MS
    );

    if (typeof renderSimulation === "function") {
        renderSimulation();
    }
}

// Stop the simulation timer.
function stopSimulation() {
    if (simulationInterval !== null) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
}

// Reset the simulation.
function resetSimulation() {
    stopSimulation();

    vehicles = [];
    vehicleId = 0;

    currentPhase = "NS";
    transition = "GREEN";
    phaseSeconds = 0;
    transitionSeconds = 0;

    signals = {
        North: "GREEN",
        South: "GREEN",
        East: "RED",
        West: "RED"
    };

    if (typeof renderSimulation === "function") {
        renderSimulation();
    }
}

// Keep a smooth animation loop if the interface uses it.
function animate(timestamp) {
    if (lastFrameTime === 0) {
        lastFrameTime = timestamp;
    }

    lastFrameTime = timestamp;

    if (typeof renderSimulation === "function") {
        renderSimulation();
    }

    animationFrame = requestAnimationFrame(animate);
}

if (typeof requestAnimationFrame === "function") {
    animationFrame = requestAnimationFrame(animate);
}
