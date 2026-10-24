// Browser-only traffic-control simulation.
// Requires the same HTML element IDs/classes as the original version.

const approaches = ["North", "South", "East", "West"];

const TICK_MS = 1000;
const ROAD_LENGTH = 100;
const STOP_LINE = 35;
const VEHICLE_SPEED = 5;
const CAR_GAP = 8;

const MIN_GREEN = 5;
const MAX_GREEN = 15;
const ALL_RED_SECONDS = 5;

// Fairness rule: after an axis has accumulated 60 seconds of normal
// green time, the opposite axis gets green for up to 30 seconds.
const FAIRNESS_LIMIT_SECONDS = 60;
const FORCED_OPPOSITE_GREEN_SECONDS = 30;

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
let pendingPhase = "NS";

let forcedGreenAfterClearance = false;
let forcedGreenSeconds = 0;

// Counts normal green time for each axis since the last fairness override.
let greenTime = {
    NS: 0,
    EW: 0
};

const intersection = document.querySelector(".intersection");

const ANIMATION_MS = 900;
let animationFrame = null;
let animationStart = 0;
let displayedStarts = new Map();
let targetVehicles = [];

function phaseForApproach(approach) {
    return ["North", "South"].includes(approach) ? "NS" : "EW";
}

function otherPhase(phase) {
    return phase === "NS" ? "EW" : "NS";
}

function approachesForPhase(phase) {
    return phase === "NS"
        ? ["North", "South"]
        : ["East", "West"];
}

function currentCounts() {
    return Object.fromEntries(
        approaches.map((approach) => [
            approach,
            vehicles.filter((vehicle) => vehicle.approach === approach).length
        ])
    );
}

function queueCounts() {
    return Object.fromEntries(
        approaches.map((approach) => [
            approach,
            vehicles.filter(
                (vehicle) =>
                    vehicle.approach === approach &&
                    vehicle.position <= STOP_LINE &&
                    vehicle.speed === 0
            ).length
        ])
    );
}

function getState() {
    return {
        elapsed_seconds: elapsedSeconds,
        traffic_counts: currentCounts(),
        queue_lengths: queueCounts(),
        signals: { ...signals },
        vehicles: vehicles.map((vehicle) => ({ ...vehicle }))
    };
}

function countForPhase(counts, phase) {
    const [first, second] = approachesForPhase(phase);
    return counts[first] + counts[second];
}

function hasTrafficForPhase(phase) {
    const phaseApproaches = approachesForPhase(phase);

    return vehicles.some((vehicle) =>
        phaseApproaches.includes(vehicle.approach)
    );
}

function chooseNextPhase(counts) {
    const nsCount = countForPhase(counts, "NS");
    const ewCount = countForPhase(counts, "EW");

    if (nsCount === ewCount) {
        return otherPhase(currentPhase);
    }

    return nsCount > ewCount ? "NS" : "EW";
}

function beginAllRed(nextPhase, startForcedGreen = false) {
    if (nextPhase === currentPhase && !startForcedGreen) {
        return;
    }

    transition = "ALL_RED";
    transitionSeconds = 0;
    pendingPhase = nextPhase;
    forcedGreenAfterClearance = startForcedGreen;
}

function triggerFairnessOverride() {
    // The axis currently green has used 60 seconds. Reset the cycle
    // and give the opposite axis a temporary green window.
    greenTime.NS = 0;
    greenTime.EW = 0;
    phaseSeconds = 0;
    forcedGreenSeconds = 0;

    beginAllRed(otherPhase(currentPhase), true);
}

function applySignalStates() {
    if (transition === "ALL_RED") {
        signals = {
            North: "RED",
            South: "RED",
            East: "RED",
            West: "RED"
        };
        return;
    }

    if (currentPhase === "NS") {
        signals = {
            North: "GREEN",
            South: "GREEN",
            East: "RED",
            West: "RED"
        };
        return;
    }

    signals = {
        North: "RED",
        South: "RED",
        East: "GREEN",
        West: "GREEN"
    };
}

function updateSignals(counts) {
    if (transition === "GREEN") {
        phaseSeconds += 1;
        greenTime[currentPhase] += 1;

        // The current axis has had 60 seconds of normal green time.
        // Give the OTHER axis green next.
        if (greenTime[currentPhase] >= FAIRNESS_LIMIT_SECONDS) {
            triggerFairnessOverride();
        } else {
            const activeTraffic = countForPhase(counts, currentPhase);
            const waitingTraffic = countForPhase(
                counts,
                otherPhase(currentPhase)
            );

            const shouldConsiderSwitch =
                phaseSeconds >= MAX_GREEN ||
                (
                    phaseSeconds >= MIN_GREEN &&
                    waitingTraffic > activeTraffic
                );

            if (shouldConsiderSwitch) {
                const nextPhase = chooseNextPhase(counts);

                if (nextPhase !== currentPhase) {
                    beginAllRed(nextPhase);
                }
            }
        }
    } else if (transition === "ALL_RED") {
        transitionSeconds += 1;

        if (transitionSeconds >= ALL_RED_SECONDS) {
            currentPhase = pendingPhase;
            phaseSeconds = 0;
            transitionSeconds = 0;

            if (forcedGreenAfterClearance) {
                transition = "FORCED_GREEN";
                forcedGreenSeconds = 0;
                forcedGreenAfterClearance = false;
            } else {
                transition = "GREEN";
            }
        }
    } else if (transition === "FORCED_GREEN") {
        forcedGreenSeconds += 1;

        // End the temporary green after 30 seconds OR as soon as all
        // vehicles on this axis have left the simulated roads.
        if (
            forcedGreenSeconds >= FORCED_OPPOSITE_GREEN_SECONDS ||
            !hasTrafficForPhase(currentPhase)
        ) {
            beginAllRed(otherPhase(currentPhase));
        }
    }

    applySignalStates();
}

function spawnVehicle(approach) {
    if (!approaches.includes(approach)) {
        return;
    }

    const roadIsBlocked = vehicles.some(
        (vehicle) =>
            vehicle.approach === approach &&
            vehicle.position < CAR_GAP
    );

    if (roadIsBlocked) {
        alert(
            `Not enough space on ${approach}. Advance the simulation first.`
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

function advanceSimulation() {
    updateSignals(currentCounts());

    for (const approach of approaches) {
        const cars = vehicles
            .filter((vehicle) => vehicle.approach === approach)
            .sort((first, second) => second.position - first.position);

        let frontPosition = Infinity;

        for (const vehicle of cars) {
            const oldPosition = vehicle.position;
            const green = signals[approach] === "GREEN";

            let nextPosition = Math.min(
                oldPosition + VEHICLE_SPEED,
                ROAD_LENGTH
            );

            if (frontPosition !== Infinity) {
                nextPosition = Math.min(
                    nextPosition,
                    frontPosition - CAR_GAP
                );
            }

            if (!green && oldPosition <= STOP_LINE) {
                nextPosition = Math.min(nextPosition, STOP_LINE);
            }

            nextPosition = Math.max(oldPosition, nextPosition);

            vehicle.position = nextPosition;
            vehicle.speed =
                nextPosition > oldPosition ? VEHICLE_SPEED : 0;

            if (
                vehicle.speed === 0 &&
                oldPosition <= STOP_LINE &&
                !green
            ) {
                vehicle.waiting_seconds += 1;
            }

            frontPosition = vehicle.position;
        }
    }

    vehicles = vehicles.filter(
        (vehicle) => vehicle.position < ROAD_LENGTH
    );

    elapsedSeconds += 1;
    renderState(getState());
}

function renderState(state) {
    const counts = state.traffic_counts;
    const queues = state.queue_lengths;

    document.getElementById("time").textContent =
        `${state.elapsed_seconds} s`;

    document.getElementById("vehicles").textContent =
        Object.values(counts).reduce((total, count) => total + count, 0);

    document.getElementById("waiting").textContent =
        Object.values(queues).reduce((total, count) => total + count, 0);

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

    approaches.forEach((approach) => {
        document.getElementById(`count-${approach}`).textContent =
            `${counts[approach]} vehicles`;

        const signal = document.getElementById(
            `signal-${approach}`
        );

        signal.classList.toggle(
            "green",
            state.signals[approach] === "GREEN"
        );

        signal.classList.toggle(
            "red",
            state.signals[approach] !== "GREEN"
        );
    });

    document.getElementById("approach-list").innerHTML =
        approaches.map((approach) => `
            <article class="approach">
                <h3>${approach}</h3>
                <p>Vehicles: <strong>${counts[approach]}</strong></p>
                <p>Waiting: <strong>${queues[approach]}</strong></p>
                <p>Signal: <strong>${state.signals[approach]}</strong></p>
            </article>
        `).join("");

    renderVehicles(state.vehicles);
}

function getCoordinates(approach, position) {
    const progress = Math.max(0, Math.min(100, position));

    switch (approach) {
        case "North":
            return { left: 43, top: progress };
        case "South":
            return { left: 54, top: 100 - progress };
        case "West":
            return { left: progress, top: 38 };
        case "East":
            return { left: 100 - progress, top: 56 };
        default:
            return { left: 50, top: 50 };
    }
}

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

function renderVehicles(items) {
    const starts = new Map();

    intersection.querySelectorAll(".vehicle").forEach((car) => {
        const id = Number(car.dataset.vehicleId);
        const position = readDisplayedPosition(car);

        if (position !== null) {
            starts.set(id, position);
        }
    });

    targetVehicles = items.map((vehicle) => ({ ...vehicle }));
    displayedStarts = new Map();

    const vehicleIds = new Set();

    targetVehicles.forEach((vehicle) => {
        vehicleIds.add(vehicle.id);

        let car = intersection.querySelector(
            `[data-vehicle-id="${vehicle.id}"]`
        );

        if (!car) {
            car = document.createElement("div");
            car.className =
                `vehicle vehicle-${vehicle.approach.toLowerCase()}`;

            car.dataset.vehicleId = vehicle.id;
            car.dataset.approach = vehicle.approach;

            const start = getCoordinates(
                vehicle.approach,
                vehicle.position
            );

            car.style.left = `${start.left}%`;
            car.style.top = `${start.top}%`;

            intersection.appendChild(car);
        }

        displayedStarts.set(
            vehicle.id,
            starts.has(vehicle.id)
                ? starts.get(vehicle.id)
                : vehicle.position
        );
    });

    intersection.querySelectorAll(".vehicle").forEach((car) => {
        if (!vehicleIds.has(Number(car.dataset.vehicleId))) {
            car.remove();
        }
    });

    if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
    }

    animationStart = performance.now();
    animationFrame = requestAnimationFrame(animateVehiclesSmooth);
}

function animateVehiclesSmooth() {
    const elapsed = performance.now() - animationStart;
    const linear = Math.min(1, elapsed / ANIMATION_MS);
    const progress = linear * linear * (3 - 2 * linear);

    targetVehicles.forEach((vehicle) => {
        const car = intersection.querySelector(
            `[data-vehicle-id="${vehicle.id}"]`
        );

        if (!car) {
            return;
        }

        const startPosition =
            displayedStarts.get(vehicle.id) ?? vehicle.position;

        const position =
            startPosition +
            (vehicle.position - startPosition) * progress;

        const coordinates = getCoordinates(
            vehicle.approach,
            position
        );

        car.style.left = `${coordinates.left}%`;
        car.style.top = `${coordinates.top}%`;

        car.title =
            `${vehicle.approach} vehicle #${vehicle.id} — ` +
            `position ${position.toFixed(1)}`;
    });

    if (linear < 1) {
        animationFrame = requestAnimationFrame(
            animateVehiclesSmooth
        );
    } else {
        animationFrame = null;
    }
}

function startSimulation() {
    if (running) {
        return;
    }

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
    if (!running) {
        return;
    }

    advanceSimulation();

    if (running) {
        timerId = setTimeout(runNextTick, TICK_MS);
    }
}

document.getElementById("run-button").addEventListener(
    "click",
    () => running ? stopSimulation() : startSimulation()
);

document.getElementById("step-button").addEventListener(
    "click",
    () => {
        if (!running) {
            advanceSimulation();
        }
    }
);

document.querySelectorAll(".spawn-button").forEach((button) => {
    button.addEventListener(
        "click",
        () => spawnVehicle(button.dataset.approach)
    );
});

renderState(getState());
