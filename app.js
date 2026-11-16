"use strict";

const STORAGE_KEY = "haru-planner-data-v1";
const state = { tasks: [], settings: { notificationsEnabled: true } };
let selectedDate = new Date();
let displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
let editingTaskId = null;
let activeReminderId = null;
let deferredInstallPrompt = null;

const $ = (selector) => document.querySelector(selector);
const calendarGrid = $("#calendarGrid");
const taskList = $("#taskList");
const monthTitle = $("#monthTitle");
const dayTitle = $("#dayTitle");
const daySummary = $("#daySummary");
const editorDialog = $("#editorDialog");
const reminderDialog = $("#reminderDialog");
const taskForm = $("#taskForm");

function pad(number) { return String(number).padStart(2, "0"); }
function dateKey(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
function dateFromKey(key) { const parts = key.split("-").map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); }
function timeNow() { const now = new Date(); return pad(now.getHours()) + ":" + pad(now.getMinutes()); }
function formatDate(date, options) { return new Intl.DateTimeFormat("ko-KR", options).format(date); }

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return;
    if (Array.isArray(saved.tasks)) state.tasks = saved.tasks;
    if (saved.settings && typeof saved.settings.notificationsEnabled === "boolean") {
      state.settings.notificationsEnabled = saved.settings.notificationsEnabled;
    }
  } catch (error) { console.warn("플래너 데이터를 불러오지 못했습니다.", error); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function tasksOn(date) {
  const key = dateKey(date);
  return state.tasks.filter((task) => task.date === key);
}

function renderCalendar() {
  monthTitle.textContent = formatDate(displayMonth, { year: "numeric", month: "long" });
  calendarGrid.replaceChildren();
  const firstDay = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);
  const daysInMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 0).getDate();
  const today = dateKey(new Date());
  const selected = dateKey(selectedDate);
  const offset = firstDay.getDay();

  for (let index = 0; index < 42; index += 1) {
    const dayNumber = index - offset + 1;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-cell";
    cell.setAttribute("role", "gridcell");
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cell.classList.add("outside-month");
      cell.tabIndex = -1;
      cell.setAttribute("aria-hidden", "true");
      calendarGrid.append(cell);
      continue;
    }
    const cellDate = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), dayNumber);
    const key = dateKey(cellDate);
    const weekday = cellDate.getDay();
    if (weekday === 0) cell.classList.add("sunday");
    if (weekday === 6) cell.classList.add("saturday");
    if (key === today) cell.classList.add("today");
    if (key === selected) cell.classList.add("selected");
    const number = document.createElement("span");
    number.textContent = String(dayNumber);
    const count = document.createElement("span");
    count.className = "calendar-count";
    const remaining = state.tasks.filter((task) => task.date === key && !task.done).length;
    count.textContent = remaining ? "· " + remaining : "";
    cell.append(number, count);
    cell.setAttribute("aria-label", formatDate(cellDate, { year: "numeric", month: "long", day: "numeric" }) + (remaining ? ", 일정 " + remaining + "개" : ""));
    cell.setAttribute("aria-selected", key === selected ? "true" : "false");
    cell.addEventListener("click", () => {
      selectedDate = cellDate;
      displayMonth = new Date(cellDate.getFullYear(), cellDate.getMonth(), 1);
      render();
    });
    calendarGrid.append(cell);
  }
}

function makeActionButton(label, symbol, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-action" + (className ? " " + className : "");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = symbol;
  button.addEventListener("click", onClick);
  return button;
}

function renderTask(task) {
  const card = document.createElement("article");
  card.className = "task-card" + (task.done ? " completed" : "");
  const time = document.createElement("time");
  time.className = "task-time";
  time.textContent = task.time;
  const main = document.createElement("div");
  main.className = "task-main";
  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;
  main.append(title);
  if (task.notes) {
    const note = document.createElement("p");
    note.className = "task-note";
    note.textContent = task.notes;
    main.append(note);
  }
  const meta = document.createElement("div");
  meta.className = "task-meta";
  const badge = document.createElement("span");
  badge.className = "reminder-badge" + (task.reminder && !task.done ? "" : " off");
  badge.textContent = task.done ? "완료" : (task.reminder ? "알림 설정됨" : "알림 없음");
  meta.append(badge);
  main.append(meta);
  const actions = document.createElement("div");
  actions.className = "task-actions";
  const done = document.createElement("input");
  done.className = "task-check";
  done.type = "checkbox";
  done.checked = Boolean(task.done);
  done.setAttribute("aria-label", task.title + " 완료 표시");
  done.addEventListener("change", () => {
    task.done = done.checked;
    if (task.done) task.snoozeUntil = "";
    saveState();
  });
  actions.append(done);
  actions.append(makeActionButton("일정 수정", "✎", "", () => openEditor(task)));
  actions.append(makeActionButton("일정 삭제", "×", "delete", () => {
    if (!window.confirm("이 일정을 삭제할까요?")) return;
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    if (activeReminderId === task.id) reminderDialog.close();
    saveState();
  }));
  card.append(time, main, actions);
  return card;
}

function renderTasks() {
  const selectedTasks = tasksOn(selectedDate).sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  dayTitle.textContent = formatDate(selectedDate, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  daySummary.textContent = selectedTasks.length ? "이 날짜의 일정 " + selectedTasks.length + "개" : "아직 등록된 일정이 없어요.";
  const enabled = state.settings.notificationsEnabled;
  const toggle = $("#notificationToggle");
  toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  $("#notificationLabel").textContent = enabled ? "알림 켜짐" : "알림 꺼짐";
  taskList.replaceChildren();
  if (!selectedTasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const mark = document.createElement("span");
    mark.className = "empty-mark";
    mark.textContent = "＋";
    const heading = document.createElement("strong");
    heading.textContent = "이날은 아직 비어 있어요";
    const message = document.createElement("p");
    message.textContent = "일정을 추가하고, 원하는 시간에 화면 알림을 받아보세요.";
    empty.append(mark, heading, message);
    taskList.append(empty);
  } else selectedTasks.forEach((task) => taskList.append(renderTask(task)));
}

function render() { renderCalendar(); renderTasks(); }

function openEditor(task) {
  editingTaskId = task ? task.id : null;
  taskForm.reset();
  $("#editorHeading").textContent = task ? "일정 수정" : "새 일정";
  $("#taskTitle").value = task ? task.title : "";
  $("#taskDate").value = task ? task.date : dateKey(selectedDate);
  const initialTime = new Date();
  initialTime.setMinutes(initialTime.getMinutes() + 15);
  $("#taskTime").value = task ? task.time : pad(initialTime.getHours()) + ":" + pad(initialTime.getMinutes());
  $("#taskNotes").value = task ? (task.notes || "") : "";
  $("#taskReminder").checked = task ? Boolean(task.reminder) : true;
  editorDialog.showModal();
  window.setTimeout(() => $("#taskTitle").focus(), 0);
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = $("#taskTitle").value.trim();
  if (!title) { $("#taskTitle").focus(); return; }
  const existing = editingTaskId ? state.tasks.find((task) => task.id === editingTaskId) : null;
  const next = {
    id: existing ? existing.id : (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
    title,
    date: $("#taskDate").value,
    time: $("#taskTime").value,
    notes: $("#taskNotes").value.trim(),
    reminder: $("#taskReminder").checked,
    done: existing ? Boolean(existing.done) : false,
    lastAlertDate: "",
    snoozeUntil: ""
  };
  if (existing) Object.assign(existing, next);
  else state.tasks.push(next);
  selectedDate = dateFromKey(next.date);
  displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  editorDialog.close();
  saveState();
});

function closeEditor() { editorDialog.close(); }
$("#closeEditor").addEventListener("click", closeEditor);
$("#cancelEditor").addEventListener("click", closeEditor);
editorDialog.addEventListener("click", (event) => { if (event.target === editorDialog) editorDialog.close(); });
$("#addButton").addEventListener("click", () => openEditor(null));
$("#previousMonth").addEventListener("click", () => {
  displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1);
  renderCalendar();
});
$("#nextMonth").addEventListener("click", () => {
  displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1);
  renderCalendar();
});
$("#todayButton").addEventListener("click", () => {
  selectedDate = new Date();
  displayMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  render();
});
$("#notificationToggle").addEventListener("click", () => {
  state.settings.notificationsEnabled = !state.settings.notificationsEnabled;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderTasks();
});

function showReminder(task) {
  activeReminderId = task.id;
  $("#reminderTime").textContent = task.time;
  $("#reminderTitle").textContent = task.title;
  $("#reminderNote").textContent = task.notes || "일정을 확인하고 천천히 시작해보세요.";
  if (!reminderDialog.open) reminderDialog.showModal();
}

function checkReminders() {
  if (!state.settings.notificationsEnabled || reminderDialog.open) return;
  const now = new Date();
  const today = dateKey(now);
  const currentTime = timeNow();
  const candidates = state.tasks.filter((task) => task.date === today && task.reminder && !task.done).sort((a, b) => a.time.localeCompare(b.time));
  for (const task of candidates) {
    const snoozeDue = task.snoozeUntil && new Date(task.snoozeUntil).getTime() <= now.getTime();
    const scheduledDue = task.time <= currentTime && task.lastAlertDate !== today;
    if (!snoozeDue && !scheduledDue) continue;
    task.lastAlertDate = today;
    task.snoozeUntil = "";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    showReminder(task);
    break;
  }
}

$("#completeReminder").addEventListener("click", () => {
  const task = state.tasks.find((item) => item.id === activeReminderId);
  if (task) { task.done = true; task.snoozeUntil = ""; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  reminderDialog.close();
  render();
});
$("#snoozeReminder").addEventListener("click", () => {
  const task = state.tasks.find((item) => item.id === activeReminderId);
  if (task) { task.snoozeUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  reminderDialog.close();
});
$("#muteReminder").addEventListener("click", () => {
  state.settings.notificationsEnabled = false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  reminderDialog.close();
  renderTasks();
});
$("#dismissReminder").addEventListener("click", () => reminderDialog.close());
reminderDialog.addEventListener("close", () => { activeReminderId = null; });

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("#installButton").hidden = false;
});
$("#installButton").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("#installButton").hidden = true;
});
window.addEventListener("appinstalled", () => { $("#installButton").hidden = true; deferredInstallPrompt = null; });

loadState();
render();
window.setInterval(checkReminders, 15000);
checkReminders();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => console.warn("오프라인 저장 기능을 시작하지 못했습니다.", error));
  });
}
