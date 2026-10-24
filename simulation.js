// Browser-only AI Traffic Control prototype for GitHub Pages.
const approaches = ["North", "South", "East", "West"];
const TICK_MS = 1000;
const ROAD_LENGTH = 100, STOP_LINE = 35, VEHICLE_SPEED = 5, CAR_GAP = 8;
const MIN_GREEN = 5, MAX_GREEN = 15, YELLOW_SECONDS = 2, ALL_RED_SECONDS = 1;

let running = false, timerId = null, elapsedSeconds = 0, nextVehicleId = 1;
let vehicles = [];
let signals = { North: "GREEN", South: "GREEN", East: "RED", West: "RED" };
let currentPhase = "NS", phaseSeconds = 0, transition = "GREEN", transitionSeconds = 0;
const intersection = document.querySelector(".intersection");
const ANIMATION_MS = 900;
let animationFrame = null;
let animationStart = 0;
let displayedStarts = new Map();
let targetVehicles = [];

function currentCounts() {
    return Object.fromEntries(approaches.map(a => [a, vehicles.filter(v => v.approach === a).length]));
}
function queueCounts() {
    return Object.fromEntries(approaches.map(a => [a, vehicles.filter(v =>
        v.approach === a && v.position <= STOP_LINE && v.speed === 0).length]));
}
function getState() {
    return {
        elapsed_seconds: elapsedSeconds,
        traffic_counts: currentCounts(),
        queue_lengths: queueCounts(),
        signals: { ...signals },
        vehicles: vehicles.map(v => ({ ...v }))
    };
}
function chooseNextPhase(counts) {
    const ns = counts.North + counts.South, ew = counts.East + counts.West;
    if (ns === ew) return currentPhase === "NS" ? "EW" : "NS";
    return ns > ew ? "NS" : "EW";
}
function updateSignals(counts) {
    phaseSeconds++;
    if (transition === "GREEN") {
        const ns = currentPhase === "NS";
        const active = ns ? counts.North + counts.South : counts.East + counts.West;
        const waiting = ns ? counts.East + counts.West : counts.North + counts.South;
        if (phaseSeconds >= MAX_GREEN || (phaseSeconds >= MIN_GREEN && waiting > active)) {
            transition = "YELLOW"; transitionSeconds = 0;
        }
    } else if (transition === "YELLOW") {
        if (++transitionSeconds >= YELLOW_SECONDS) {
            transition = "ALL_RED"; transitionSeconds = 0;
        }
    } else if (transition === "ALL_RED") {
        if (++transitionSeconds >= ALL_RED_SECONDS) {
            currentPhase = chooseNextPhase(counts);
            transition = "GREEN"; phaseSeconds = 0; transitionSeconds = 0;
        }
    }
    if (transition === "GREEN") {
        signals = currentPhase === "NS"
            ? { North: "GREEN", South: "GREEN", East: "RED", West: "RED" }
            : { North: "RED", South: "RED", East: "GREEN", West: "GREEN" };
    } else {
        signals = { North: "RED", South: "RED", East: "RED", West: "RED" };
    }
}
function spawnVehicle(approach) {
    if (vehicles.some(v => v.approach === approach && v.position < CAR_GAP)) {
        alert(`Not enough space on ${approach}. Advance the simulation to make room.`);
        return;
    }
    vehicles.push({ id: nextVehicleId++, approach, position: 0, waiting_seconds: 0, speed: 0 });
    renderState(getState());
}
function advanceSimulation() {
    updateSignals(currentCounts());
    for (const approach of approaches) {
        const cars = vehicles.filter(v => v.approach === approach).sort((a,b) => b.position-a.position);
        let front = Infinity;
        for (const v of cars) {
            const old = v.position, green = signals[approach] === "GREEN";
            let next = Math.min(old + VEHICLE_SPEED, ROAD_LENGTH);
            if (front !== Infinity) next = Math.min(next, front - CAR_GAP);
            if (!green && old <= STOP_LINE) next = Math.min(next, STOP_LINE);
            next = Math.max(old, next);
            v.position = next;
            v.speed = next > old ? VEHICLE_SPEED : 0;
            if (v.speed === 0 && old <= STOP_LINE && !green) v.waiting_seconds++;
            front = v.position;
        }
    }
    vehicles = vehicles.filter(v => v.position < ROAD_LENGTH);
    elapsedSeconds++;
    renderState(getState());
}
function renderState(state) {
    const counts = state.traffic_counts, queues = state.queue_lengths;
    document.getElementById("time").textContent = `${state.elapsed_seconds} s`;
    document.getElementById("vehicles").textContent = Object.values(counts).reduce((a,b)=>a+b,0);
    document.getElementById("waiting").textContent = Object.values(queues).reduce((a,b)=>a+b,0);
    const nsGreen = state.signals.North === "GREEN" || state.signals.South === "GREEN";
    const ewGreen = state.signals.East === "GREEN" || state.signals.West === "GREEN";
    document.getElementById("phase").textContent = nsGreen ? "North–South" : ewGreen ? "East–West" : "All Red";
    approaches.forEach(a => {
        document.getElementById(`count-${a}`).textContent = `${counts[a]} vehicles`;
        const light = document.getElementById(`signal-${a}`);
        light.classList.toggle("green", state.signals[a] === "GREEN");
        light.classList.toggle("red", state.signals[a] !== "GREEN");
    });
    document.getElementById("approach-list").innerHTML = approaches.map(a => `
        <article class="approach"><h3>${a}</h3>
        <p>Vehicles: <strong>${counts[a]}</strong></p>
        <p>Waiting: <strong>${queues[a]}</strong></p>
        <p>Signal: <strong>${state.signals[a]}</strong></p></article>`).join("");
    renderVehicles(state.vehicles);
}
function getCoordinates(approach, position) {
    const p = Math.max(0, Math.min(100, position));
    switch (approach) {
        case "North": return { left: 43, top: p };
        case "South": return { left: 54, top: 100-p };
        case "West": return { left: p, top: 38 };
        case "East": return { left: 100-p, top: 56 };
        default: return { left: 50, top: 50 };
    }
}
function readDisplayedPosition(car) {
    const approach = car.dataset.approach;
    const left = parseFloat(car.style.left);
    const top = parseFloat(car.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    if (approach === "North") return top;
    if (approach === "South") return 100 - top;
    if (approach === "West") return left;
    return 100 - left;
}

function renderVehicles(items) {
    // Begin each tick from the cars' actual on-screen positions, not their
    // previous target positions. This prevents animation jumps between ticks.
    const starts = new Map();
    intersection.querySelectorAll(".vehicle").forEach(car => {
        const id = Number(car.dataset.vehicleId);
        const position = readDisplayedPosition(car);
        if (position !== null) starts.set(id, position);
    });

    targetVehicles = items.map(v => ({ ...v }));
    displayedStarts = new Map();
    const ids = new Set();

    targetVehicles.forEach(v => {
        ids.add(v.id);
        let car = intersection.querySelector(`[data-vehicle-id="${v.id}"]`);
        if (!car) {
            car = document.createElement("div");
            car.className = `vehicle vehicle-${v.approach.toLowerCase()}`;
            car.dataset.vehicleId = v.id;
            car.dataset.approach = v.approach;
            const start = getCoordinates(v.approach, v.position);
            car.style.left = `${start.left}%`;
            car.style.top = `${start.top}%`;
            intersection.appendChild(car);
        }
        displayedStarts.set(v.id, starts.has(v.id) ? starts.get(v.id) : v.position);
    });

    intersection.querySelectorAll(".vehicle").forEach(car => {
        if (!ids.has(Number(car.dataset.vehicleId))) car.remove();
    });

    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationStart = performance.now();
    animationFrame = requestAnimationFrame(animateVehiclesSmooth);
}

function animateVehiclesSmooth() {
    const elapsed = performance.now() - animationStart;
    const linear = Math.min(1, elapsed / ANIMATION_MS);
    // Smoothstep easing: gentle acceleration and deceleration each second.
    const progress = linear * linear * (3 - 2 * linear);

    targetVehicles.forEach(v => {
        const car = intersection.querySelector(`[data-vehicle-id="${v.id}"]`);
        if (!car) return;
        const from = displayedStarts.get(v.id) ?? v.position;
        const position = from + (v.position - from) * progress;
        const c = getCoordinates(v.approach, position);
        car.style.left = `${c.left}%`;
        car.style.top = `${c.top}%`;
        car.title = `${v.approach} vehicle #${v.id} — position ${position.toFixed(1)}`;
    });

    if (linear < 1) {
        animationFrame = requestAnimationFrame(animateVehiclesSmooth);
    } else {
        animationFrame = null;
    }
}
function startSimulation() {
    if (running) return;
    running = true;
    document.getElementById("run-button").textContent = "⏸ Pause simulation";
    runNextTick();
}
function stopSimulation() {
    running = false;
    if (timerId !== null) clearTimeout(timerId);
    timerId = null;
    document.getElementById("run-button").textContent = "▶ Run simulation";
}
function runNextTick() {
    if (!running) return;
    advanceSimulation();
    if (running) timerId = setTimeout(runNextTick, TICK_MS);
}
document.getElementById("run-button").addEventListener("click", () => running ? stopSimulation() : startSimulation());
document.getElementById("step-button").addEventListener("click", () => { if (!running) advanceSimulation(); });
document.querySelectorAll(".spawn-button").forEach(button => button.addEventListener("click", () => spawnVehicle(button.dataset.approach)));
renderState(getState());
