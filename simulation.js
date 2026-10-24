
 // Browser-only AI Traffic Control prototype for GitHub Pages.
const approaches = ["North", "South", "East", "West"];

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

let running = false;
let timerId = null;
let elapsedSeconds = 0;
let nextVehicleId = 1;

let vehicles = [];

let signals = {
    North: "GREEN",
    South: "GREEN",
    East: "RED",
    West: "RED"
};

let currentPhase = "NS";
let phaseSeconds = 0;
let transition = "GREEN";
let transitionSeconds = 0;

// Fairness override state.
let greenTime = {
    NS: 0,
    EW: 0
};

let overrideSeconds = 0;
let pendingPhase = "NS";
let overrideAfterClearance = false;

const intersection = document.querySelector(".intersection");

const ANIMATION_MS = 900;
let animationFrame = null;
let animationStart = 0;
let displayedStarts = new Map();
let targetVehicles = [];

// Count vehicles on each approach.
function currentCounts() {
    return Object.fromEntries(
        approaches.map(a => [
            a,
            vehicles.filter(v => v.approach === a).length
        ])
    );
}

// Count vehicles waiting at the stop line.
function queueCounts() {
    return Object.fromEntries(
        approaches.map(a => [
            a,
            vehicles.filter(v =>
                v.approach === a &&
                v.position <= STOP_LINE &&
                v.speed === 0
            ).length
        ])
    );
}

// Return the complete simulation state.
function getState() {
    return {
        elapsed_seconds: elapsedSeconds,
        traffic_counts: currentCounts(),
        queue_lengths: queueCounts(),
        signals: { ...signals },
        vehicles: vehicles.map(v => ({ ...v }))
    };
}

// Normal adaptive phase selection.
// The fairness override prevents one axis from monopolising green.
function chooseNextPhase(counts) {
    const ns = counts.North + counts.South;
    const ew = counts.East + counts.West;

    if (ns === ew) {
        return currentPhase === "NS" ? "EW" : "NS";
    }

    return ns > ew ? "NS" : "EW";
}

// Check whether any E-W vehicles remain on the simulated roads.
function hasEWTraffic() {
    return vehicles.some(v =>
        v.approach === "East" ||
        v.approach === "West"
    );
}

// Begin an all-red clearance before changing phases.
function beginAllRed(nextPhase, isOverride = false) {
    transition = "ALL_RED";
    transitionSeconds = 0;
    pendingPhase = nextPhase;
    overrideAfterClearance = isOverride;
}

// Activate the E-W fairness override.
function triggerEWOverride() {
    // Reset the fairness counters so the same accumulated time
    // cannot immediately trigger another override.
    greenTime.NS = 0;
    greenTime.EW = 0;

    phaseSeconds = 0;
    overrideSeconds = 0;

    if (currentPhase === "EW") {
        // E-W already has green: extend it as the override.
        transition = "EW_OVERRIDE";
        transitionSeconds = 0;
        overrideAfterClearance = false;
    } else {
        // N-S is green: clear the intersection first.
        beginAllRed("EW", true);
    }
}

// Update signal phases and enforce the fairness override.
function updateSignals(counts) {
    if (transition === "GREEN") {
        phaseSeconds++;

        // Count cumulative normal green time for each axis.
        greenTime[currentPhase]++;

        // FAIRNESS OVERRIDE:
        // If either axis exceeds 60 seconds, prioritise E-W.
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

            // Normal adaptive switching.
            if (
                phaseSeconds >= MAX_GREEN ||
                (
                    phaseSeconds >= MIN_GREEN &&
                    waiting > active
                )
            ) {
                beginAllRed(chooseNextPhase(counts));
            }
        }
    } else if (transition === "ALL_RED") {
        // Every signal remains red during clearance.
        transitionSeconds++;

        if (transitionSeconds >= ALL_RED_SECONDS) {
            currentPhase = pendingPhase;

            phaseSeconds = 0;
            transitionSeconds = 0;

            if (overrideAfterClearance) {
                // Start the guaranteed E-W priority window.
                transition = "EW_OVERRIDE";
                overrideSeconds = 0;
                overrideAfterClearance = false;
            } else {
                transition = "GREEN";
            }
        }
    } else if (transition === "EW_OVERRIDE") {
        // E-W retains green until its traffic clears or 30 seconds pass.
        overrideSeconds++;

        if (
            overrideSeconds >= EW_OVERRIDE_SECONDS ||
            !hasEWTraffic()
        ) {
            // Return to N-S after a complete 5-second clearance.
            beginAllRed("NS");
        }
    }

    // Apply signal states AFTER all transition decisions.
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

// Spawn a vehicle using the original interface function.
function spawnVehicle(approach) {
    if (!approaches.includes(approach)) return;

    if (
        vehicles.some(v =>
            v.approach === approach &&
            v.position < CAR_GAP
        )
    ) {
        alert(
            `Not enough space on ${approach}. Advance the simulation to make room.`
        );
        return;
    }

    vehicles.push({
        id: nextVehicleId++,
        approach,
        position: 0,
        waiting_seconds: 0,
        speed: 0
    });

    renderState(getState());
}

// Advance vehicles without crossing a red signal.
function advanceSimulation() {
    updateSignals(currentCounts());

    for (const approach of approaches) {
        const cars = vehicles
            .filter(v => v.approach === approach)
            .sort((a, b) => b.position - a.position);

        let front = Infinity;

        for (const v of cars) {
            const old = v.position;
            const green = signals[approach] === "GREEN";

            let next = Math.min(
                old + VEHICLE_SPEED,
                ROAD_LENGTH
            );

            // Maintain spacing from the vehicle ahead.
            if (front !== Infinity) {
                next = Math.min(next, front - CAR_GAP);
            }

            // Stop at the stop line on red or during clearance.
            if (!green && old <= STOP_LINE) {
                next = Math.min(next, STOP_LINE);
            }

            // Never move a vehicle backwards.
            next = Math.max(old, next);

            v.position = next;
            v.speed = next > old ? VEHICLE_SPEED : 0;

            if (
                v.speed === 0 &&
                old <= STOP_LINE &&
                !green
            ) {
                v.waiting_seconds++;
            }

            front = v.position;
        }
    }

    // Remove vehicles that have exited the road.
    vehicles = vehicles.filter(
        v => v.position < ROAD_LENGTH
    );

    elapsedSeconds++;

    renderState(getState());
}

// Render dashboard statistics, lights, and vehicles.
function renderState(state) {
    const counts = state.traffic_counts;
    const queues = state.queue_lengths;

    document.getElementById("time").textContent =
        `${state.elapsed_seconds} s`;

    document.getElementById("vehicles").textContent =
        Object.values(counts).reduce((a, b) => a + b, 0);

    document.getElementById("waiting").textContent =
        Object.values(queues).reduce((a, b) => a + b, 0);

    const nsGreen =
        state.signals.North === "GREEN" ||
        state.signals.South === "GREEN";

    const ewGreen =
        state.signals.East === "GREEN" ||
        state.signals.West === "GREEN";

    document.getElementById("phase").textContent =
        nsGreen
            ? "North–South"
            : ewGreen
                ? "East–West"
                : "All Red";

    approaches.forEach(a => {
        document.getElementById(`count-${a}`).textContent =
            `${counts[a]} vehicles`;

        const light = document.getElementById(`signal-${a}`);

        light.classList.toggle(
            "green",
            state.signals[a] === "GREEN"
        );

        light.classList.toggle(
            "red",
            state.signals[a] !== "GREEN"
        );
    });

    document.getElementById("approach-list").innerHTML =
        approaches.map(a => `
            <article class="approach">
                <h3>${a}</h3>
                <p>Vehicles: <strong>${counts[a]}</strong></p>
                <p>Waiting: <strong>${queues[a]}</strong></p>
                <p>Signal: <strong>${state.signals[a]}</strong></p>
            </article>
        `).join("");

    renderVehicles(state.vehicles);
}

// Convert vehicle position into intersection coordinates.
function getCoordinates(approach, position) {
    const p = Math.max(0, Math.min(100, position));

    switch (approach) {
        case "North":
            return { left: 43, top: p };
        case "South":
            return { left: 54, top: 100 - p };
        case "West":
            return { left: p, top: 38 };
        case "East":
            return { left: 100 - p, top: 56 };
        default:
            return { left: 50, top: 50 };
    }
}

// Read the current displayed vehicle position.
function readDisplayedPosition(car) {
    const approach = car.dataset.approach;
    const left = parseFloat(car.style.left);
    const top = parseFloat(car.style.top);

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
    }

    if (approach === "North") return top;
    if (approach === "South") return 100 - top;
    if (approach === "West") return left;

    return 100 - left;
}

// Render and animate vehicles using the original system.
function renderVehicles(items) {
    const starts = new Map();

    intersection.querySelectorAll(".vehicle").forEach(car => {
        const id = Number(car.dataset.vehicleId);
        const position = readDisplayedPosition(car);

        if (position !== null) {
            starts.set(id, position);
        }
    });

    targetVehicles = items.map(v => ({ ...v }));
    displayedStarts = new Map();

    const ids = new Set();

    targetVehicles.forEach(v => {
        ids.add(v.id);

        let car = intersection.querySelector(
            `[data-vehicle-id="${v.id}"]`
        );

        if (!car) {
            car = document.createElement("div");
            car.className =
                `vehicle vehicle-${v.approach.toLowerCase()}`;

            car.dataset.vehicleId = v.id;
            car.dataset.approach = v.approach;

            const start = getCoordinates(v.approach, v.position);

            car.style.left = `${start.left}%`;
            car.style.top = `${start.top}%`;

            intersection.appendChild(car);
        }

        displayedStarts.set(
            v.id,
            starts.has(v.id) ? starts.get(v.id) : v.position
        );
    });

    intersection.querySelectorAll(".vehicle").forEach(car => {
        if (!ids.has(Number(car.dataset.vehicleId))) {
            car.remove();
        }
    });

    if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
    }

    animationStart = performance.now();
    animationFrame = requestAnimationFrame(animateVehiclesSmooth);
}

// Smoothly animate vehicles between simulation ticks.
function animateVehiclesSmooth() {
    const elapsed = performance.now() - animationStart;
    const linear = Math.min(1, elapsed / ANIMATION_MS);
    const progress = linear * linear * (3 - 2 * linear);

    targetVehicles.forEach(v => {
        const car = intersection.querySelector(
            `[data-vehicle-id="${v.id}"]`
        );

        if (!car) return;

        const from = displayedStarts.get(v.id) ?? v.position;
        const position = from + (v.position - from) * progress;
        const c = getCoordinates(v.approach, position);

        car.style.left = `${c.left}%`;
        car.style.top = `${c.top}%`;

        car.title =
            `${v.approach} vehicle #${v.id} — position ${position.toFixed(1)}`;
    });

    if (linear < 1) {
        animationFrame = requestAnimationFrame(animateVehiclesSmooth);
    } else {
        animationFrame = null;
    }
}

// Start using the original button and timer architecture.
function startSimulation() {
    if (running) return;

    running = true;

    document.getElementById("run-button").textContent =
        "⏸ Pause simulation";

    runNextTick();
}

function stopSimulation() {
    running = false;

    if (timerId !== null) {
        clearTimeout(timerId);
    }

    timerId = null;

    document.getElementById("run-button").textContent =
        "▶ Run simulation";
}

function runNextTick() {
    if (!running) return;

    advanceSimulation();

    if (running) {
        timerId = setTimeout(runNextTick, TICK_MS);
    }
}

// Preserve the original interface event listeners.
document.getElementById("run-button").addEventListener(
    "click",
    () => running ? stopSimulation() : startSimulation()
);

document.getElementById("step-button").addEventListener(
    "click",
    () => {
        if (!running) advanceSimulation();
    }
);

document.querySelectorAll(".spawn-button").forEach(button => {
    button.addEventListener(
        "click",
        () => spawnVehicle(button.dataset.approach)
    );
});

// Initialise the interface.
renderState(getState());

if (typeof requestAnimationFrame === "function") {
    animationFrame = requestAnimationFrame(animate);
}
