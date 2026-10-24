
const TICK_MS = 1000;
const ROAD_LENGTH = 100;
const STOP_LINE = 35;
const VEHICLE_SPEED = 5;
const CAR_GAP = 8;

const MIN_GREEN = 5;
const MAX_GREEN = 15;

const ALL_RED_SECONDS = 5;
const OVERRIDE_LIMIT_SECONDS = 60;
const EW_OVERRIDE_SECONDS = 30;

let currentPhase = "NS";
let transition = "GREEN";

let phaseSeconds = 0;
let transitionSeconds = 0;
let overrideSeconds = 0;

// Pending phase during all-red clearance.
let pendingPhase = "NS";
let overrideAfterClearance = false;

// Green time accumulated since the last fairness override.
let greenTime = {
    NS: 0,
    EW: 0
};

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

// Return the total number of vehicles on each approach.
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
        if (vehicle.stopped && vehicle.position >= STOP_LINE) {
            queues[vehicle.direction]++;
        }
    });

    return queues;
}

// Check whether any E-W vehicles remain on the roads.
// Vehicles past the stop line are included until they exit.
function hasEWTraffic() {
    return vehicles.some(vehicle =>
        vehicle.direction === "East" ||
        vehicle.direction === "West"
    );
}

// Begin a normal all-red clearance before changing phases.
function beginAllRed(nextPhase) {
    transition = "ALL_RED";
    transitionSeconds = 0;
    pendingPhase = nextPhase;
    overrideAfterClearance = false;
}

// Begin the fairness override.
// If N-S is currently green, use the full red clearance.
// If E-W is already green, convert directly to override mode.
function triggerEWOverride() {
    // Reset accumulated time so the same threshold cannot
    // retrigger continuously after this override.
    greenTime.NS = 0;
    greenTime.EW = 0;

    phaseSeconds = 0;
    overrideSeconds = 0;

    if (currentPhase === "EW") {
        transition = "EW_OVERRIDE";
    } else {
        transition = "ALL_RED";
        transitionSeconds = 0;
        pendingPhase = "EW";
        overrideAfterClearance = true;
    }
}

// Update signal phases and timers.
function updateSignals(counts) {
    if (transition === "GREEN") {
        phaseSeconds++;

        // Accumulate green time for the currently active axis.
        greenTime[currentPhase]++;

        // FAIRNESS OVERRIDE:
        // If either axis exceeds 60 seconds of accumulated
        // normal green time, give E-W priority.
        if (
            greenTime.NS > OVERRIDE_LIMIT_SECONDS ||
            greenTime.EW > OVERRIDE_LIMIT_SECONDS
        ) {
            triggerEWOverride();
        } else {
            const isNS = currentPhase === "NS";

            const active = isNS
                ? counts.North + counts.South
                : counts.East + counts.West;

            const waiting = isNS
                ? counts.East + counts.West
                : counts.North + counts.South;

            // Normal adaptive signal switching.
            if (
                phaseSeconds >= MAX_GREEN ||
                (
                    phaseSeconds >= MIN_GREEN &&
                    waiting > active
                )
            ) {
                beginAllRed(chooseNextPhase());
            }
        }
    } else if (transition === "ALL_RED") {
        transitionSeconds++;

        // Keep all signals red for the full five-second clearance.
        if (transitionSeconds >= ALL_RED_SECONDS) {
            currentPhase = pendingPhase;

            phaseSeconds = 0;
            transitionSeconds = 0;

            if (overrideAfterClearance) {
                transition = "EW_OVERRIDE";
                overrideSeconds = 0;
                overrideAfterClearance = false;
            } else {
                transition = "GREEN";
            }
        }
    } else if (transition === "EW_OVERRIDE") {
        // E-W has exclusive green priority during this window.
        overrideSeconds++;

        // End the override when either:
        // 1. Thirty seconds have elapsed, OR
        // 2. All E-W vehicles have cleared the roads.
        if (
            overrideSeconds >= EW_OVERRIDE_SECONDS ||
            !hasEWTraffic()
        ) {
            // E-W is currently green, so use clearance before NS.
            beginAllRed("NS");
        }
    }

    // Apply the final signal states after transition handling.
    if (transition === "ALL_RED") {
        signals = {
            North: "RED",
            South: "RED",
            East: "RED",
            West: "RED"
        };
    } else if (
        transition === "EW_OVERRIDE" ||
        currentPhase === "EW"
    ) {
        signals = {
            North: "RED",
            South: "RED",
            East: "GREEN",
            West: "GREEN"
        };
    } else {
        signals = {
            North: "GREEN",
            South: "GREEN",
            East: "RED",
            West: "RED"
        };
    }
}

// Add a vehicle to a selected road.
function addVehicle(direction) {
    const validDirections = ["North", "South", "East", "West"];

    if (!validDirections.includes(direction)) return;

    const roadVehicles = vehicles.filter(
        vehicle => vehicle.direction === direction
    );

    // Keep space between vehicles entering the road.
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

// Move vehicles without crossing a red signal.
function moveVehicles() {
    const directions = ["North", "South", "East", "West"];

    directions.forEach(direction => {
        // Front vehicle first.
        const roadVehicles = vehicles
            .filter(vehicle => vehicle.direction === direction)
            .sort((a, b) => b.position - a.position);

        roadVehicles.forEach((vehicle, index) => {
            const vehicleAhead = roadVehicles[index - 1];

            let nextPosition =
                vehicle.position + VEHICLE_SPEED;

            // Prevent vehicles from overlapping.
            if (vehicleAhead) {
                nextPosition = Math.min(
                    nextPosition,
                    vehicleAhead.position - CAR_GAP
                );
            }

            // Stop at the stop line if the light is not green.
            if (signals[direction] !== "GREEN") {
                if (
                    vehicle.position < STOP_LINE &&
                    nextPosition >= STOP_LINE
                ) {
                    nextPosition = STOP_LINE;
                }

                // Do not move a waiting vehicle on red.
                if (vehicle.position >= STOP_LINE) {
                    nextPosition = vehicle.position;
                }
            }

            vehicle.position = nextPosition;

            vehicle.stopped =
                signals[direction] !== "GREEN" &&
                vehicle.position >= STOP_LINE;
        });
    });

    // Remove vehicles that have completely left the road.
    vehicles = vehicles.filter(
        vehicle => vehicle.position < ROAD_LENGTH
    );
}

// Advance the simulation by one second.
function advanceSimulation() {
    const counts = currentCounts();

    updateSignals(counts);
    moveVehicles();

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

// Reset the entire simulation.
function resetSimulation() {
    stopSimulation();

    vehicles = [];
    vehicleId = 0;

    currentPhase = "NS";
    transition = "GREEN";

    phaseSeconds = 0;
    transitionSeconds = 0;
    overrideSeconds = 0;

    pendingPhase = "NS";
    overrideAfterClearance = false;

    greenTime = {
        NS: 0,
        EW: 0
    };

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

// Keep the display animated if supported by the interface.
function animate(timestamp) {
    lastFrameTime = timestamp;

    if (typeof renderSimulation === "function") {
        renderSimulation();
    }

    animationFrame = requestAnimationFrame(animate);
}

if (typeof requestAnimationFrame === "function") {
    animationFrame = requestAnimationFrame(animate);
}
