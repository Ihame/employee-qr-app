"use strict";

// Public by design: this is the anon key, meant to be embedded in frontend
// code. Direct table access for this role is locked down by RLS (no
// policies) — all reads/writes go through the edge functions below, which
// use the service-role key server-side.
const SUPABASE_URL = "https://niqntideqrkgqvqlcaxl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pcW50aWRlcXJrZ3F2cWxjYXhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NzM3OTIsImV4cCI6MjEwNTU0OTc5Mn0.EWu51cvzX84slKnunS5p6DdnfuR9N7yQX4yVs_luDpY";
const FUNCTIONS_BASE = SUPABASE_URL + "/functions/v1";

async function apiFetch(path, options) {
	const res = await fetch(FUNCTIONS_BASE + path, {
		...options,
		headers: {
			"apikey": SUPABASE_ANON_KEY,
			"Authorization": "Bearer " + SUPABASE_ANON_KEY,
			"Content-Type": "application/json",
			...(options && options.headers),
		},
	});
	let data = null;
	try { data = await res.json(); } catch (e) { /* empty body */ }
	if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
	return data;
}

const api = {
	listEmployees: () => apiFetch("/employees"),
	createEmployee: (payload) => apiFetch("/employees", { method: "POST", body: JSON.stringify(payload) }),
	updateEmployee: (payload) => apiFetch("/employees", { method: "PUT", body: JSON.stringify(payload) }),
	deleteEmployee: (id) => apiFetch("/employees?id=" + encodeURIComponent(id), { method: "DELETE" }),
	getLogo: () => apiFetch("/settings"),
	setLogo: (logo) => apiFetch("/settings", { method: "PUT", body: JSON.stringify({ logo }) }),
	removeLogo: () => apiFetch("/settings", { method: "DELETE" }),
};

let records = [];
let logoDataUrl = "";

const els = {
	form: document.getElementById("employee-form"),
	formTitle: document.getElementById("form-title"),
	formError: document.getElementById("form-error"),
	name: document.getElementById("input-name"),
	id: document.getElementById("input-id"),
	department: document.getElementById("input-department"),
	phone: document.getElementById("input-phone"),
	recordId: document.getElementById("input-record-id"),
	btnClear: document.getElementById("btn-clear"),
	btnGenerate: document.getElementById("btn-generate"),
	btnDownload: document.getElementById("btn-download"),
	canvas: document.getElementById("qr-canvas"),
	canvasEmptyHint: document.getElementById("canvas-empty-hint"),
	qrStatus: document.getElementById("qr-status"),
	logoInput: document.getElementById("input-logo"),
	logoPreview: document.getElementById("logo-preview"),
	btnRemoveLogo: document.getElementById("btn-remove-logo"),
	btnRefresh: document.getElementById("btn-refresh"),
	searchBox: document.getElementById("search-box"),
	tableBody: document.getElementById("employee-table-body"),
	emptyMessage: document.getElementById("empty-message"),
	listError: document.getElementById("list-error"),
	btnExport: document.getElementById("btn-export"),
	importInput: document.getElementById("input-import"),
	syncBadge: document.getElementById("sync-badge"),
	syncBadgeText: document.getElementById("sync-badge-text"),
	toastContainer: document.getElementById("toast-container"),
	confirmOverlay: document.getElementById("confirm-overlay"),
	confirmMessage: document.getElementById("confirm-message"),
	confirmOk: document.getElementById("confirm-ok"),
	confirmCancel: document.getElementById("confirm-cancel"),
};

// ---------- UI helpers ----------

function showToast(message, type = "info") {
	const toast = document.createElement("div");
	toast.className = "toast " + type;
	toast.textContent = message;
	els.toastContainer.appendChild(toast);
	setTimeout(() => toast.remove(), 4000);
}

function confirmDialog(message) {
	els.confirmMessage.textContent = message;
	els.confirmOverlay.hidden = false;
	return new Promise((resolve) => {
		const cleanup = (result) => {
			els.confirmOverlay.hidden = true;
			els.confirmOk.removeEventListener("click", onOk);
			els.confirmCancel.removeEventListener("click", onCancel);
			resolve(result);
		};
		const onOk = () => cleanup(true);
		const onCancel = () => cleanup(false);
		els.confirmOk.addEventListener("click", onOk);
		els.confirmCancel.addEventListener("click", onCancel);
	});
}

function setSyncBadge(state, text) {
	els.syncBadge.className = "sync-badge " + state;
	els.syncBadgeText.textContent = text;
}

function setBusy(button, busy) {
	button.disabled = busy;
	const spinner = button.querySelector(".spinner");
	const label = button.querySelector(".btn-label");
	if (spinner) spinner.hidden = !busy;
	if (label && button.dataset.idleLabel === undefined) button.dataset.idleLabel = label.textContent;
	if (label) label.textContent = busy ? "Saving…" : button.dataset.idleLabel;
}

// ---------- QR rendering ----------

function vCardEscape(value) {
	return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function computeQrText(rec) {
	const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vCardEscape(rec.name)}`];
	if (rec.department) lines.push(`ORG:${vCardEscape(rec.department)}`);
	if (rec.phone) lines.push(`TEL:${vCardEscape(rec.phone)}`);
	lines.push("END:VCARD");
	return lines.join("\n");
}

function roundRectPath(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function drawLogoOnCanvas(ctx, size, dataUrl) {
	return new Promise((resolve) => {
		if (!dataUrl) { resolve(); return; }
		const img = new Image();
		img.onload = () => {
			const boxSize = size * 0.26;
			const boxX = (size - boxSize) / 2;
			const boxY = (size - boxSize) / 2;
			ctx.fillStyle = "#ffffff";
			roundRectPath(ctx, boxX, boxY, boxSize, boxSize, boxSize * 0.18);
			ctx.fill();
			const pad = boxSize * 0.12;
			const innerSize = boxSize - pad * 2;
			const scale = Math.min(innerSize / img.width, innerSize / img.height);
			const drawW = img.width * scale;
			const drawH = img.height * scale;
			const dx = boxX + (boxSize - drawW) / 2;
			const dy = boxY + (boxSize - drawH) / 2;
			ctx.drawImage(img, dx, dy, drawW, drawH);
			resolve();
		};
		img.onerror = () => resolve();
		img.src = dataUrl;
	});
}

async function renderQr(text) {
	const canvas = els.canvas;
	const ctx = canvas.getContext("2d");
	if (!text.trim()) {
		canvas.hidden = true;
		els.canvasEmptyHint.hidden = false;
		els.qrStatus.textContent = "";
		return;
	}
	canvas.hidden = false;
	els.canvasEmptyHint.hidden = true;
	let qr;
	try {
		qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.HIGH);
	} catch (e) {
		els.qrStatus.textContent = "Could not generate a QR code from this data: " + e.message;
		return;
	}
	const border = 2;
	const cellsAcross = qr.size + border * 2;
	const targetPx = 640;
	const scale = Math.max(4, Math.floor(targetPx / cellsAcross));
	const size = cellsAcross * scale;
	canvas.width = size;
	canvas.height = size;
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, size, size);
	ctx.fillStyle = "#000000";
	for (let y = -border; y < qr.size + border; y++) {
		for (let x = -border; x < qr.size + border; x++) {
			if (qr.getModule(x, y)) {
				ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
			}
		}
	}
	await drawLogoOnCanvas(ctx, size, logoDataUrl);
	els.qrStatus.textContent = "Scanning this with a phone camera offers to save the name and number as a contact.";
}

function currentFormRecord() {
	return {
		recordId: els.recordId.value || "",
		name: els.name.value.trim(),
		employeeId: els.id.value.trim(),
		department: els.department.value.trim(),
		phone: els.phone.value.trim(),
	};
}

function refreshPreview() {
	const rec = currentFormRecord();
	if (!rec.name) {
		renderQr("");
		return;
	}
	renderQr(computeQrText(rec));
}

// ---------- Form handling ----------

function clearForm() {
	els.form.reset();
	els.recordId.value = "";
	els.formTitle.textContent = "New employee";
	els.formError.hidden = true;
	renderQr("");
}

els.form.addEventListener("submit", async (e) => {
	e.preventDefault();
	els.formError.hidden = true;
	const rec = currentFormRecord();
	if (!rec.name) return;

	setBusy(els.btnGenerate, true);
	try {
		const isNew = !rec.recordId;
		const saved = isNew ? await api.createEmployee(rec) : await api.updateEmployee(rec);
		const idx = records.findIndex(r => r.recordId === saved.recordId);
		if (idx >= 0) records[idx] = saved;
		else records.push(saved);

		els.recordId.value = saved.recordId;
		els.id.value = saved.employeeId;
		els.formTitle.textContent = `Editing: ${saved.name}`;
		renderQr(computeQrText(saved));
		renderTable(saved.recordId);
		showToast(isNew ? `Saved ${saved.name}.` : `Updated ${saved.name}.`, "success");
	} catch (err) {
		els.formError.textContent = err.message;
		els.formError.hidden = false;
	} finally {
		setBusy(els.btnGenerate, false);
	}
});

els.btnClear.addEventListener("click", clearForm);

[els.name, els.id, els.department, els.phone].forEach(input => {
	input.addEventListener("input", refreshPreview);
});

els.btnDownload.addEventListener("click", () => {
	const rec = currentFormRecord();
	if (!rec.name) {
		showToast("Enter a name and generate a QR code first.", "error");
		return;
	}
	const filename = (rec.employeeId || rec.name).replace(/[^a-z0-9-_]+/gi, "_") + "-qr.png";
	const link = document.createElement("a");
	link.download = filename;
	link.href = els.canvas.toDataURL("image/png");
	link.click();
});

// ---------- Logo handling ----------

function applyLogoPreview() {
	if (logoDataUrl) {
		els.logoPreview.src = logoDataUrl;
		els.logoPreview.hidden = false;
	} else {
		els.logoPreview.hidden = true;
		els.logoPreview.removeAttribute("src");
	}
}

els.logoInput.addEventListener("change", () => {
	const file = els.logoInput.files[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = async () => {
		const newLogo = reader.result;
		try {
			await api.setLogo(newLogo);
			logoDataUrl = newLogo;
			applyLogoPreview();
			refreshPreview();
			showToast("Logo updated for everyone.", "success");
		} catch (err) {
			showToast("Could not save logo: " + err.message, "error");
		}
	};
	reader.readAsDataURL(file);
});

els.btnRemoveLogo.addEventListener("click", async () => {
	try {
		await api.removeLogo();
		logoDataUrl = "";
		els.logoInput.value = "";
		applyLogoPreview();
		refreshPreview();
		showToast("Logo removed for everyone.", "success");
	} catch (err) {
		showToast("Could not remove logo: " + err.message, "error");
	}
});

// ---------- Table / list ----------

function formatDate(iso) {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function showTableSkeleton() {
	els.tableBody.innerHTML = "";
	els.emptyMessage.hidden = true;
	els.listError.hidden = true;
	for (let i = 0; i < 3; i++) {
		const tr = document.createElement("tr");
		tr.className = "skeleton-row";
		for (let c = 0; c < 5; c++) {
			const td = document.createElement("td");
			const bar = document.createElement("div");
			bar.className = "skeleton-bar";
			td.appendChild(bar);
			tr.appendChild(td);
		}
		els.tableBody.appendChild(tr);
	}
}

function renderTable(highlightId) {
	const query = els.searchBox.value.trim().toLowerCase();
	const filtered = records
		.filter(r => !query ||
			r.name.toLowerCase().includes(query) ||
			r.employeeId.toLowerCase().includes(query) ||
			r.department.toLowerCase().includes(query))
		.sort((a, b) => a.name.localeCompare(b.name));

	els.tableBody.innerHTML = "";
	els.emptyMessage.hidden = records.length > 0;
	els.emptyMessage.textContent = records.length === 0
		? "No employees saved yet. Add one on the left to get started."
		: (filtered.length === 0 ? "No matches." : "");
	if (records.length > 0) els.emptyMessage.hidden = filtered.length > 0;

	for (const rec of filtered) {
		const tr = document.createElement("tr");
		if (rec.recordId === highlightId) tr.className = "new-row";

		const tdName = document.createElement("td");
		tdName.textContent = rec.name;
		tr.appendChild(tdName);

		const tdId = document.createElement("td");
		tdId.textContent = rec.employeeId;
		tr.appendChild(tdId);

		const tdDept = document.createElement("td");
		tdDept.textContent = rec.department;
		tr.appendChild(tdDept);

		const tdDate = document.createElement("td");
		tdDate.textContent = formatDate(rec.updatedAt);
		tr.appendChild(tdDate);

		const tdActions = document.createElement("td");
		tdActions.className = "row-actions";

		const editBtn = document.createElement("button");
		editBtn.textContent = "Edit";
		editBtn.type = "button";
		editBtn.className = "secondary";
		editBtn.addEventListener("click", () => loadIntoForm(rec.recordId));
		tdActions.appendChild(editBtn);

		const delBtn = document.createElement("button");
		delBtn.textContent = "Delete";
		delBtn.type = "button";
		delBtn.className = "danger";
		delBtn.addEventListener("click", () => deleteRecord(rec.recordId));
		tdActions.appendChild(delBtn);

		tr.appendChild(tdActions);
		els.tableBody.appendChild(tr);
	}
}

function loadIntoForm(recordId) {
	const rec = records.find(r => r.recordId === recordId);
	if (!rec) return;
	els.recordId.value = rec.recordId;
	els.name.value = rec.name;
	els.id.value = rec.employeeId;
	els.department.value = rec.department;
	els.phone.value = rec.phone;
	els.formTitle.textContent = `Editing: ${rec.name}`;
	els.formError.hidden = true;
	renderQr(computeQrText(rec));
	els.name.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteRecord(recordId) {
	const rec = records.find(r => r.recordId === recordId);
	if (!rec) return;
	const ok = await confirmDialog(`Delete "${rec.name}" (${rec.employeeId})? This removes it for everyone and cannot be undone.`);
	if (!ok) return;
	try {
		await api.deleteEmployee(recordId);
		records = records.filter(r => r.recordId !== recordId);
		if (els.recordId.value === recordId) clearForm();
		renderTable();
		showToast(`Deleted ${rec.name}.`, "success");
	} catch (err) {
		showToast("Could not delete: " + err.message, "error");
	}
}

els.searchBox.addEventListener("input", () => renderTable());

async function loadEmployees() {
	showTableSkeleton();
	try {
		records = await api.listEmployees();
		renderTable();
	} catch (err) {
		els.tableBody.innerHTML = "";
		els.listError.textContent = "Could not load the saved list: " + err.message;
		els.listError.hidden = false;
		throw err;
	}
}

els.btnRefresh.addEventListener("click", async () => {
	els.btnRefresh.classList.add("spinning");
	try {
		await loadEmployees();
	} catch (e) { /* already shown */ }
	els.btnRefresh.classList.remove("spinning");
});

// ---------- Export / import ----------

els.btnExport.addEventListener("click", () => {
	const payload = { records, logoDataUrl, exportedAt: new Date().toISOString() };
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.download = "employee-qr-backup.json";
	link.href = url;
	link.click();
	URL.revokeObjectURL(url);
});

els.importInput.addEventListener("change", () => {
	const file = els.importInput.files[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = async () => {
		try {
			const data = JSON.parse(reader.result);
			const incoming = Array.isArray(data.records) ? data.records : [];
			const named = incoming.filter(inc => inc.name);
			const ok = await confirmDialog(`Import ${named.length} employee(s)? Entries with a matching Employee ID will be updated in the shared list; others will be added.`);
			if (!ok) return;

			let added = 0, updated = 0, failed = 0;
			for (const inc of named) {
				try {
					const existing = records.find(r => r.employeeId && inc.employeeId && r.employeeId.toLowerCase() === inc.employeeId.toLowerCase());
					const payload = {
						recordId: existing ? existing.recordId : undefined,
						name: inc.name,
						employeeId: inc.employeeId || "",
						department: inc.department || "",
						phone: inc.phone || "",
					};
					const saved = existing ? await api.updateEmployee(payload) : await api.createEmployee(payload);
					const idx = records.findIndex(r => r.recordId === saved.recordId);
					if (idx >= 0) { records[idx] = saved; updated++; } else { records.push(saved); added++; }
				} catch (e) {
					failed++;
				}
			}
			if (data.logoDataUrl && !logoDataUrl) {
				try {
					await api.setLogo(data.logoDataUrl);
					logoDataUrl = data.logoDataUrl;
					applyLogoPreview();
				} catch (e) { /* ignore logo import failure */ }
			}
			renderTable();
			showToast(`Import complete: ${added} added, ${updated} updated${failed ? `, ${failed} failed` : ""}.`, failed ? "error" : "success");
		} catch (e) {
			showToast("This file doesn't look like a valid backup.", "error");
		}
	};
	reader.readAsText(file);
	els.importInput.value = "";
});

// ---------- Init ----------

async function init() {
	clearForm();
	setSyncBadge("", "Connecting…");
	try {
		const [logoResult] = await Promise.all([
			api.getLogo().catch(() => ({ logo: "" })),
			loadEmployees(),
		]);
		logoDataUrl = logoResult.logo || "";
		applyLogoPreview();
		setSyncBadge("ok", "Connected");
	} catch (err) {
		setSyncBadge("error", "Offline — changes won't save");
	}
}

init();
