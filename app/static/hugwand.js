const refs = {
  enableCameraButton: document.getElementById("enableCameraButton"),
  disarmButton: document.getElementById("disarmButton"),
  cameraStatusChip: document.getElementById("cameraStatusChip"),
  cameraStatusText: document.getElementById("cameraStatusText"),
  trackingStatusChip: document.getElementById("trackingStatusChip"),
  trackingStatusText: document.getElementById("trackingStatusText"),
  systemStatusChip: document.getElementById("systemStatusChip"),
  systemStatusText: document.getElementById("systemStatusText"),
  liveIndicator: document.getElementById("liveIndicator"),
  video: document.getElementById("cameraFeed"),
  canvas: document.getElementById("gestureOverlay"),
  gestureLabel: document.getElementById("gestureLabel"),
  commandLabel: document.getElementById("commandLabel"),
  pointerLabel: document.getElementById("pointerLabel"),
  platformLabel: document.getElementById("platformLabel"),
  operatorPrompt: document.getElementById("operatorPrompt"),
  eventLog: document.getElementById("eventLog"),
  gestureGrid: document.getElementById("gestureGrid"),
};

const state = {
  armed: false,
  cameraReady: false,
  trackingReady: false,
  stableGesture: "idle",
  stableSince: 0,
  lastGesture: "idle",
  wristTrail: [],
  actionCooldowns: new Map(),
  pointerPending: false,
  lastPointerAt: 0,
  clickPending: false,
  config: null,
  camera: null,
  hands: null,
  started: false,
};

const GESTURE_LABELS = {
  idle: "No hand detected",
  tracking: "Tracking hand",
  open_palm: "Open palm",
  fist: "Closed fist",
  peace: "Peace sign",
  point: "Pointing",
  pinch: "Pinch click",
  thumbs_up: "Thumbs up",
  thumbs_down: "Thumbs down",
};

const ACTION_LABELS = {
  volume_up: "Volume Up",
  volume_down: "Volume Down",
  play_pause: "Play / Pause",
  next_track: "Next Track",
  previous_track: "Previous Track",
  task_view: "Task View",
  show_desktop: "Show Desktop",
  left_click: "Left Click",
};

const ACTION_COOLDOWNS = {
  volume_up: 1400,
  volume_down: 1400,
  play_pause: 1600,
  next_track: 1600,
  previous_track: 1600,
  task_view: 2200,
  show_desktop: 2200,
  left_click: 800,
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  boot();
});

function bindEvents() {
  refs.enableCameraButton.addEventListener("click", startCamera);
  refs.disarmButton.addEventListener("click", () => {
    disarmSystem("Emergency stop activated.");
    logEvent("Emergency stop pressed from the control panel.");
  });
}

async function boot() {
  logEvent("HugWand is booting.");
  await loadConfig();
  renderGestureGrid();
}

async function loadConfig() {
  try {
    const response = await fetch("/hugwand/config");
    if (!response.ok) {
      throw new Error(`Config request failed with ${response.status}`);
    }

    state.config = await response.json();
    refs.platformLabel.textContent = state.config.platform;
    refs.pointerLabel.textContent = state.config.pointer_enabled ? "Ready" : "Unavailable";
    refs.operatorPrompt.textContent = state.config.pointer_enabled
      ? "Enable the camera, center one hand in frame, then hold an open palm for 1.2 seconds to arm HugWand."
      : "Desktop control works best on Windows. The interface will still track gestures, but desktop actions stay disabled on this platform.";

    logEvent(
      state.config.pointer_enabled
        ? `Running on ${state.config.platform} with live pointer control.`
        : `Running on ${state.config.platform}. Desktop actions are disabled in this prototype.`,
    );
  } catch (error) {
    refs.platformLabel.textContent = "Unavailable";
    refs.operatorPrompt.textContent = "Backend config could not be loaded. Start the FastAPI app and refresh the page.";
    logEvent(`Config error: ${error.message}`);
  }
}

function renderGestureGrid() {
  if (!state.config || !Array.isArray(state.config.actions)) {
    refs.gestureGrid.innerHTML = "";
    return;
  }

  refs.gestureGrid.innerHTML = state.config.actions
    .map(
      (item) => `
        <article class="gesture-card">
          <span>${escapeHtml(item.trigger)}</span>
          <strong>${escapeHtml(item.label)}</strong>
          <p>${escapeHtml(item.effect)}</p>
        </article>
      `,
    )
    .join("");
}

async function startCamera() {
  if (state.started) {
    refs.operatorPrompt.textContent = "Camera is already running. Hold an open palm to arm the system.";
    return;
  }

  if (!window.Hands || !window.Camera) {
    refs.operatorPrompt.textContent = "MediaPipe did not load. Check your internet connection and refresh the page.";
    logEvent("MediaPipe assets are unavailable.");
    setChipState(refs.cameraStatusChip, refs.cameraStatusText, "alert", "Unavailable");
    return;
  }

  try {
    state.hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    state.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });

    state.hands.onResults(onResults);

    state.camera = new window.Camera(refs.video, {
      onFrame: async () => {
        await state.hands.send({ image: refs.video });
      },
      width: 1280,
      height: 720,
    });

    await state.camera.start();
    state.started = true;
    state.cameraReady = true;
    setChipState(refs.cameraStatusChip, refs.cameraStatusText, "active", "Online");
    refs.liveIndicator.dataset.state = "active";
    refs.liveIndicator.textContent = "Live";
    refs.operatorPrompt.textContent = "Camera enabled. Show one hand to the webcam, then hold an open palm to arm HugWand.";
    logEvent("Camera permission granted. Vision pipeline is live.");
  } catch (error) {
    setChipState(refs.cameraStatusChip, refs.cameraStatusText, "alert", "Denied");
    refs.liveIndicator.dataset.state = "idle";
    refs.liveIndicator.textContent = "Idle";
    refs.operatorPrompt.textContent = "Camera access was blocked. Allow webcam permission and try again.";
    logEvent(`Camera error: ${error.message}`);
  }
}

function onResults(results) {
  syncCanvasSize();
  drawFrame(results);

  const landmarks = results.multiHandLandmarks && results.multiHandLandmarks[0];
  if (!landmarks) {
    state.lastGesture = "idle";
    state.wristTrail = [];
    setTracking(false);
    refs.gestureLabel.textContent = GESTURE_LABELS.idle;
    refs.commandLabel.textContent = state.armed ? "Armed stand by" : "Stand by";
    refs.pointerLabel.textContent = state.config && state.config.pointer_enabled ? "Ready" : "Unavailable";
    refs.operatorPrompt.textContent = state.armed
      ? "System armed. Re-enter frame to move the pointer or show a gesture command."
      : "No hand detected. Center one hand in the frame and hold an open palm to arm the system.";
    return;
  }

  setTracking(true);

  const gestureData = classifyGesture(landmarks);
  refs.gestureLabel.textContent = GESTURE_LABELS[gestureData.gesture] || GESTURE_LABELS.tracking;

  handleGesture(gestureData);
}

function syncCanvasSize() {
  const width = refs.video.videoWidth || 1280;
  const height = refs.video.videoHeight || 720;
  if (refs.canvas.width !== width || refs.canvas.height !== height) {
    refs.canvas.width = width;
    refs.canvas.height = height;
  }
}

function drawFrame(results) {
  const context = refs.canvas.getContext("2d");
  context.save();
  context.clearRect(0, 0, refs.canvas.width, refs.canvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
    for (const landmarks of results.multiHandLandmarks) {
      window.drawConnectors(context, landmarks, window.HAND_CONNECTIONS, {
        color: "rgba(195, 255, 98, 0.75)",
        lineWidth: 3,
      });
      window.drawLandmarks(context, landmarks, {
        color: "#07110c",
        fillColor: "rgba(235, 255, 184, 0.92)",
        lineWidth: 1.5,
        radius: 4,
      });
    }
  }

  context.restore();
}

function classifyGesture(landmarks) {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const thumbBase = landmarks[2];
  const indexBase = landmarks[5];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const thumbExtended =
    Math.abs(thumbTip.x - thumbBase.x) > 0.09 && Math.abs(thumbTip.x - indexBase.x) > 0.08;
  const indexExtended = fingerExtended(landmarks[8], landmarks[6], landmarks[5]);
  const middleExtended = fingerExtended(landmarks[12], landmarks[10], landmarks[9]);
  const ringExtended = fingerExtended(landmarks[16], landmarks[14], landmarks[13]);
  const pinkyExtended = fingerExtended(landmarks[20], landmarks[18], landmarks[17]);
  const pinchDistance = distance(thumbTip, indexTip);
  const pinch = pinchDistance < 0.05;

  const openPalm = thumbExtended && indexExtended && middleExtended && ringExtended && pinkyExtended;
  const fist =
    !thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended && !pinch;
  const peace = indexExtended && middleExtended && !ringExtended && !pinkyExtended && !pinch;
  const point = indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
  const thumbsUp =
    thumbExtended &&
    !indexExtended &&
    !middleExtended &&
    !ringExtended &&
    !pinkyExtended &&
    thumbTip.y < wrist.y - 0.08;
  const thumbsDown =
    thumbExtended &&
    !indexExtended &&
    !middleExtended &&
    !ringExtended &&
    !pinkyExtended &&
    thumbTip.y > wrist.y + 0.08;

  let gesture = "tracking";
  if (pinch && point) {
    gesture = "pinch";
  } else if (openPalm) {
    gesture = "open_palm";
  } else if (fist) {
    gesture = "fist";
  } else if (thumbsUp) {
    gesture = "thumbs_up";
  } else if (thumbsDown) {
    gesture = "thumbs_down";
  } else if (peace) {
    gesture = "peace";
  } else if (point) {
    gesture = "point";
  }

  return {
    gesture,
    wrist,
    indexTip,
    middleTip,
    ringTip,
    pinkyTip,
  };
}

function handleGesture(gestureData) {
  const holdMs = updateStableGesture(gestureData.gesture);

  if (!state.armed) {
    if (gestureData.gesture === "open_palm") {
      const remaining = Math.max(0, 1200 - holdMs);
      refs.operatorPrompt.textContent =
        remaining > 0
          ? `Hold that open palm steady for ${Math.ceil(remaining / 100) / 10} more seconds to arm HugWand.`
          : "HugWand is arming.";
      if (holdMs >= 1200) {
        armSystem();
      }
    } else {
      refs.operatorPrompt.textContent =
        "System disarmed. Show a steady open palm for 1.2 seconds to enter live gesture control.";
    }
    return;
  }

  if (gestureData.gesture === "fist" && holdMs >= 850) {
    disarmSystem("Closed fist detected. HugWand is now disarmed.");
    logEvent("Closed fist emergency stop recognized.");
    return;
  }

  handleSwipe(gestureData);
  handlePointer(gestureData);

  if (gestureData.gesture === "pinch" && holdMs >= 200) {
    fireAction("left_click", "Pinch click fired.");
  } else if (gestureData.gesture === "peace" && holdMs >= 700) {
    fireAction("play_pause", "Peace sign toggled playback.");
  } else if (gestureData.gesture === "thumbs_up" && holdMs >= 650) {
    fireAction("volume_up", "Thumbs up raised volume.");
  } else if (gestureData.gesture === "thumbs_down" && holdMs >= 650) {
    fireAction("volume_down", "Thumbs down lowered volume.");
  }

  refs.operatorPrompt.textContent = buildOperatorPrompt(gestureData.gesture, holdMs);
}

function handleSwipe(gestureData) {
  if (!state.armed || gestureData.gesture !== "open_palm") {
    state.wristTrail = [];
    return;
  }

  const now = performance.now();
  state.wristTrail.push({ x: gestureData.wrist.x, y: gestureData.wrist.y, t: now });
  state.wristTrail = state.wristTrail.filter((point) => now - point.t < 420);

  if (state.wristTrail.length < 3) {
    return;
  }

  const start = state.wristTrail[0];
  const dx = gestureData.wrist.x - start.x;
  const dy = gestureData.wrist.y - start.y;

  if (Math.abs(dx) > 0.18 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    state.wristTrail = [];
    fireAction(dx > 0 ? "next_track" : "previous_track", dx > 0 ? "Palm swipe right detected." : "Palm swipe left detected.");
    return;
  }

  if (Math.abs(dy) > 0.2 && Math.abs(dy) > Math.abs(dx) * 1.25) {
    state.wristTrail = [];
    fireAction(dy > 0 ? "show_desktop" : "task_view", dy > 0 ? "Palm swipe down detected." : "Palm swipe up detected.");
  }
}

function handlePointer(gestureData) {
  if (!state.config || !state.config.pointer_enabled) {
    refs.pointerLabel.textContent = "Unavailable";
    return;
  }

  if (gestureData.gesture !== "point" && gestureData.gesture !== "pinch") {
    refs.pointerLabel.textContent = "Stand by";
    return;
  }

  refs.pointerLabel.textContent = "Live";
  const now = performance.now();
  if (state.pointerPending || now - state.lastPointerAt < 90) {
    return;
  }

  state.lastPointerAt = now;
  state.pointerPending = true;

  postJson("/hugwand/pointer", {
    x: clamp(1 - gestureData.indexTip.x, 0.02, 0.98),
    y: clamp(gestureData.indexTip.y, 0.04, 0.96),
  })
    .catch((error) => {
      logEvent(`Pointer error: ${error.message}`);
    })
    .finally(() => {
      state.pointerPending = false;
    });
}

function buildOperatorPrompt(gesture, holdMs) {
  if (gesture === "point" || gesture === "pinch") {
    return "Pointer mode live. Move your index finger to steer the cursor and pinch to click.";
  }
  if (gesture === "open_palm") {
    return holdMs < 260
      ? "Open palm detected. Swipe left or right for track controls, or swipe up and down for desktop actions."
      : "Palm ready. Move quickly to trigger a swipe command, or hold a fist to stop the system.";
  }
  if (gesture === "peace") {
    return "Hold the peace sign steady to toggle media playback.";
  }
  if (gesture === "thumbs_up") {
    return "Hold thumbs up to raise volume.";
  }
  if (gesture === "thumbs_down") {
    return "Hold thumbs down to lower volume.";
  }
  if (gesture === "fist") {
    return "Closed fist detected. Hold a moment longer to disarm HugWand.";
  }
  return "System armed. Point to move the cursor or show a gesture command.";
}

function armSystem() {
  if (state.armed) {
    return;
  }

  state.armed = true;
  refs.commandLabel.textContent = "System armed";
  setChipState(refs.systemStatusChip, refs.systemStatusText, "active", "Armed");
  logEvent("Open palm hold confirmed. System armed.");
}

function disarmSystem(message) {
  state.armed = false;
  refs.commandLabel.textContent = "Stand by";
  refs.pointerLabel.textContent = state.config && state.config.pointer_enabled ? "Ready" : "Unavailable";
  refs.operatorPrompt.textContent = message || "System disarmed. Show an open palm to arm HugWand again.";
  setChipState(refs.systemStatusChip, refs.systemStatusText, "idle", "Disarmed");
  state.wristTrail = [];
}

async function fireAction(action, note) {
  if (!state.armed) {
    return;
  }

  const now = performance.now();
  const lastFired = state.actionCooldowns.get(action) || 0;
  const cooldown = ACTION_COOLDOWNS[action] || 1400;

  if (now - lastFired < cooldown) {
    return;
  }

  state.actionCooldowns.set(action, now);
  refs.commandLabel.textContent = ACTION_LABELS[action] || action;
  logEvent(note);

  try {
    const response = await postJson("/hugwand/action", {
      action,
      confidence: 0.94,
      gesture: state.lastGesture,
      source: "webcam",
    });

    if (response && typeof response.detail === "string") {
      logEvent(response.detail);
    }
    if (response && response.ok === false) {
      setChipState(refs.systemStatusChip, refs.systemStatusText, "alert", "Limited");
    } else if (state.armed) {
      setChipState(refs.systemStatusChip, refs.systemStatusText, "active", "Armed");
    }
  } catch (error) {
    logEvent(`Action error: ${error.message}`);
    setChipState(refs.systemStatusChip, refs.systemStatusText, "alert", "Error");
  }
}

function updateStableGesture(gesture) {
  const now = performance.now();
  if (state.stableGesture !== gesture) {
    state.stableGesture = gesture;
    state.stableSince = now;
  }
  state.lastGesture = gesture;
  return now - state.stableSince;
}

function setTracking(active) {
  if (state.trackingReady === active) {
    return;
  }
  state.trackingReady = active;
  setChipState(refs.trackingStatusChip, refs.trackingStatusText, active ? "active" : "idle", active ? "Locked" : "Waiting");
}

function setChipState(chip, label, status, text) {
  chip.dataset.status = status;
  label.textContent = text;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }

  return response.json();
}

function logEvent(message) {
  const item = document.createElement("li");
  const now = new Date();
  item.textContent = `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}  ${message}`;
  refs.eventLog.prepend(item);

  while (refs.eventLog.children.length > 6) {
    refs.eventLog.removeChild(refs.eventLog.lastChild);
  }
}

function fingerExtended(tip, pip, mcp) {
  return tip.y < pip.y - 0.04 && pip.y < mcp.y - 0.01;
}

function distance(pointA, pointB) {
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
