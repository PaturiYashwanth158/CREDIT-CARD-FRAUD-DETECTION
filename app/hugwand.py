from __future__ import annotations

import ctypes
import platform
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field


HugWandAction = Literal[
    "volume_up",
    "volume_down",
    "play_pause",
    "next_track",
    "previous_track",
    "task_view",
    "show_desktop",
    "left_click",
]

ACTION_LABELS: dict[HugWandAction, str] = {
    "volume_up": "Volume Up",
    "volume_down": "Volume Down",
    "play_pause": "Play / Pause",
    "next_track": "Next Track",
    "previous_track": "Previous Track",
    "task_view": "Task View",
    "show_desktop": "Show Desktop",
    "left_click": "Left Click",
}


class HugWandActionDefinition(BaseModel):
    action: HugWandAction
    label: str
    trigger: str
    effect: str


class HugWandConfigResponse(BaseModel):
    product_name: str
    platform: str
    pointer_enabled: bool
    screen_width: int
    screen_height: int
    actions: list[HugWandActionDefinition]


class HugWandActionRequest(BaseModel):
    action: HugWandAction
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    gesture: str | None = None
    source: str = "webcam"


class HugWandActionResponse(BaseModel):
    ok: bool
    action: HugWandAction
    label: str
    detail: str
    platform: str


class HugWandPointerRequest(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)


class HugWandPointerResponse(BaseModel):
    ok: bool
    detail: str
    platform: str


class DesktopController:
    KEYEVENTF_KEYUP = 0x0002
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    VK_VOLUME_UP = 0xAF
    VK_VOLUME_DOWN = 0xAE
    VK_MEDIA_PLAY_PAUSE = 0xB3
    VK_MEDIA_NEXT_TRACK = 0xB0
    VK_MEDIA_PREV_TRACK = 0xB1
    VK_LWIN = 0x5B
    VK_TAB = 0x09
    VK_D = 0x44

    def __init__(self) -> None:
        self.platform = platform.system().lower()
        self._user32 = ctypes.WinDLL("user32", use_last_error=True) if self.platform == "windows" else None

    @property
    def pointer_enabled(self) -> bool:
        return self.platform == "windows" and self._user32 is not None

    def screen_size(self) -> tuple[int, int]:
        if not self.pointer_enabled:
            return (0, 0)
        return (self._user32.GetSystemMetrics(0), self._user32.GetSystemMetrics(1))

    def perform(self, action: HugWandAction) -> str:
        if not self.pointer_enabled:
            return "Desktop control is available on Windows in this prototype."

        if action == "volume_up":
            self._tap_key(self.VK_VOLUME_UP)
            return "Raised the system volume."
        if action == "volume_down":
            self._tap_key(self.VK_VOLUME_DOWN)
            return "Lowered the system volume."
        if action == "play_pause":
            self._tap_key(self.VK_MEDIA_PLAY_PAUSE)
            return "Toggled media playback."
        if action == "next_track":
            self._tap_key(self.VK_MEDIA_NEXT_TRACK)
            return "Skipped to the next media track."
        if action == "previous_track":
            self._tap_key(self.VK_MEDIA_PREV_TRACK)
            return "Moved to the previous media track."
        if action == "task_view":
            self._press_combo(self.VK_LWIN, self.VK_TAB)
            return "Opened Windows Task View."
        if action == "show_desktop":
            self._press_combo(self.VK_LWIN, self.VK_D)
            return "Toggled the desktop view."
        if action == "left_click":
            self.left_click()
            return "Sent a left mouse click."
        raise ValueError(f"Unsupported action: {action}")

    def move_pointer(self, normalized_x: float, normalized_y: float) -> str:
        if not self.pointer_enabled:
            return "Pointer control is unavailable on this platform."

        width, height = self.screen_size()
        target_x = int(max(0.0, min(1.0, normalized_x)) * max(width - 1, 1))
        target_y = int(max(0.0, min(1.0, normalized_y)) * max(height - 1, 1))
        self._user32.SetCursorPos(target_x, target_y)
        return f"Pointer moved to {target_x}, {target_y}."

    def left_click(self) -> None:
        if not self.pointer_enabled:
            return
        self._user32.mouse_event(self.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        self._user32.mouse_event(self.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

    def _tap_key(self, virtual_key: int) -> None:
        if not self.pointer_enabled:
            return
        self._user32.keybd_event(virtual_key, 0, 0, 0)
        self._user32.keybd_event(virtual_key, 0, self.KEYEVENTF_KEYUP, 0)

    def _press_combo(self, *virtual_keys: int) -> None:
        if not self.pointer_enabled:
            return
        for key in virtual_keys:
            self._user32.keybd_event(key, 0, 0, 0)
        for key in reversed(virtual_keys):
            self._user32.keybd_event(key, 0, self.KEYEVENTF_KEYUP, 0)


@lru_cache(maxsize=1)
def get_desktop_controller() -> DesktopController:
    return DesktopController()


def build_hugwand_config() -> HugWandConfigResponse:
    controller = get_desktop_controller()
    width, height = controller.screen_size()
    actions = [
        HugWandActionDefinition(
            action="volume_up",
            label=ACTION_LABELS["volume_up"],
            trigger="Thumbs up hold",
            effect="Raise the active system volume.",
        ),
        HugWandActionDefinition(
            action="volume_down",
            label=ACTION_LABELS["volume_down"],
            trigger="Thumbs down hold",
            effect="Lower the active system volume.",
        ),
        HugWandActionDefinition(
            action="play_pause",
            label=ACTION_LABELS["play_pause"],
            trigger="Peace sign hold",
            effect="Toggle music or video playback.",
        ),
        HugWandActionDefinition(
            action="next_track",
            label=ACTION_LABELS["next_track"],
            trigger="Open palm swipe right",
            effect="Skip to the next media item.",
        ),
        HugWandActionDefinition(
            action="previous_track",
            label=ACTION_LABELS["previous_track"],
            trigger="Open palm swipe left",
            effect="Return to the previous media item.",
        ),
        HugWandActionDefinition(
            action="task_view",
            label=ACTION_LABELS["task_view"],
            trigger="Open palm swipe up",
            effect="Open Windows Task View.",
        ),
        HugWandActionDefinition(
            action="show_desktop",
            label=ACTION_LABELS["show_desktop"],
            trigger="Open palm swipe down",
            effect="Hide windows and show the desktop.",
        ),
        HugWandActionDefinition(
            action="left_click",
            label=ACTION_LABELS["left_click"],
            trigger="Pinch while pointing",
            effect="Send a left mouse click.",
        ),
    ]
    return HugWandConfigResponse(
        product_name="HugWand",
        platform=controller.platform,
        pointer_enabled=controller.pointer_enabled,
        screen_width=width,
        screen_height=height,
        actions=actions,
    )
