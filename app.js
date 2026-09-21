"use strict";

const STORAGE_KEY = "employeeQr.records";
const LOGO_KEY = "employeeQr.logo";

/** @type {Array<{recordId:string, name:string, employeeId:string, department:string, phone:string, updatedAt:string}>} */
let records = loadRecords();
let logoDataUrl = localStorage.getItem(LOGO_KEY) || "";

const els = {
	form: document.getElementById("employee-form"),
	formTitle: document.getElementById("form-title"),
	name: document.getElementById("input-name"),
	id: document.getElementById("input-id"),
	department: document.getElementById("input-department"),
	phone: document.getElementById("input-phone"),
	recordId: document.getElementById("input-record-id"),
	btnClear: document.getElementById("btn-clear"),
	btnDownload: document.getElementById("btn-download"),
	canvas: document.getElementById("qr-canvas"),
	qrStatus: document.getElementById("qr-status"),
	logoInput: document.getElementById("input-logo"),
	logoPreview: document.getElementById("logo-preview"),
	btnRemoveLogo: document.getElementById("btn-remove-logo"),
	searchBox: document.getElementById("search-box"),
	tableBody: document.getElementById("employee-table-body"),
	emptyMessage: document.getElementById("empty-message"),
	btnExport: document.getElementById("btn-export"),
	importInput: document.getElementById("input-import"),
};

function loadRecords() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch (e) {
		console.error("Could not read saved employees, starting fresh.", e);
		return [];
	}
}

function saveRecords() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function makeId() {
	if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
	return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function generateEmployeeId(excludeRecordId) {
	const used = new Set(
		records.filter(r => r.recordId !== excludeRecordId).map(r => r.employeeId)
	);
	let n = records.length + 1;
	let candidate;
	do {
		candidate = "EMP-" + String(n).padStart(4, "0");
		n++;
	} while (used.has(candidate));
	return candidate;
}

// ---------- QR rendering ----------

// Escapes text for use inside a vCard field value, per RFC 6350.
function vCardEscape(value) {
	return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

// Encodes just the name and phone number as a vCard, so scanning the QR code
// with a phone's camera offers to save/show a contact card, not raw text.
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
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		els.qrStatus.textContent = "";
		return;
	}
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
	renderQr("");
}

els.form.addEventListener("submit", (e) => {
	e.preventDefault();
	const name = els.name.value.trim();
	if (!name) return;

	let recordId = els.recordId.value;
	const isNew = !recordId;
	if (isNew) recordId = makeId();

	let employeeId = els.id.value.trim();
	const duplicate = records.find(r => r.recordId !== recordId && r.employeeId.toLowerCase() === employeeId.toLowerCase());
	if (!employeeId) {
		employeeId = generateEmployeeId(recordId);
	} else if (duplicate) {
		alert(`Employee ID "${employeeId}" is already used by ${duplicate.name}. Please use a different ID.`);
		return;
	}

	const rec = {
		recordId,
		name,
		employeeId,
		department: els.department.value.trim(),
		phone: els.phone.value.trim(),
		updatedAt: new Date().toISOString(),
	};

	const idx = records.findIndex(r => r.recordId === recordId);
	if (idx >= 0) records[idx] = rec;
	else records.push(rec);

	saveRecords();
	els.recordId.value = recordId;
	els.id.value = employeeId;
	els.formTitle.textContent = `Editing: ${name}`;
	renderQr(computeQrText(rec));
	renderTable();
});

els.btnClear.addEventListener("click", clearForm);

[els.name, els.id, els.department, els.phone].forEach(input => {
	input.addEventListener("input", refreshPreview);
});

els.btnDownload.addEventListener("click", () => {
	const rec = currentFormRecord();
	if (!rec.name) {
		alert("Generate a QR code first (enter a name).");
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
	reader.onload = () => {
		logoDataUrl = reader.result;
		try {
			localStorage.setItem(LOGO_KEY, logoDataUrl);
		} catch (e) {
			alert("This logo image is too large to save in the browser. Try a smaller image.");
			logoDataUrl = localStorage.getItem(LOGO_KEY) || "";
		}
		applyLogoPreview();
		refreshPreview();
	};
	reader.readAsDataURL(file);
});

els.btnRemoveLogo.addEventListener("click", () => {
	logoDataUrl = "";
	localStorage.removeItem(LOGO_KEY);
	els.logoInput.value = "";
	applyLogoPreview();
	refreshPreview();
});

// ---------- Table / list ----------

function formatDate(iso) {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderTable() {
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
		? "No employees saved yet."
		: (filtered.length === 0 ? "No matches." : "");
	if (records.length > 0) els.emptyMessage.hidden = filtered.length > 0;

	for (const rec of filtered) {
		const tr = document.createElement("tr");

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
		editBtn.className = "secondary";
		editBtn.addEventListener("click", () => loadIntoForm(rec.recordId));
		tdActions.appendChild(editBtn);

		const delBtn = document.createElement("button");
		delBtn.textContent = "Delete";
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
	renderQr(computeQrText(rec));
	els.name.scrollIntoView({ behavior: "smooth", block: "center" });
}

function deleteRecord(recordId) {
	const rec = records.find(r => r.recordId === recordId);
	if (!rec) return;
	if (!confirm(`Delete "${rec.name}" (${rec.employeeId})? This cannot be undone.`)) return;
	records = records.filter(r => r.recordId !== recordId);
	saveRecords();
	if (els.recordId.value === recordId) clearForm();
	renderTable();
}

els.searchBox.addEventListener("input", renderTable);

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
	reader.onload = () => {
		try {
			const data = JSON.parse(reader.result);
			const incoming = Array.isArray(data.records) ? data.records : [];
			if (!confirm(`Import ${incoming.length} employee(s)? Entries with a matching Employee ID will be updated; others will be added.`)) return;
			for (const inc of incoming) {
				if (!inc.name) continue;
				const existingIdx = records.findIndex(r => r.employeeId && inc.employeeId && r.employeeId.toLowerCase() === inc.employeeId.toLowerCase());
				const rec = {
					recordId: existingIdx >= 0 ? records[existingIdx].recordId : makeId(),
					name: inc.name,
					employeeId: inc.employeeId || generateEmployeeId(""),
					department: inc.department || "",
					phone: inc.phone || "",
					updatedAt: inc.updatedAt || new Date().toISOString(),
				};
				if (existingIdx >= 0) records[existingIdx] = rec;
				else records.push(rec);
			}
			if (data.logoDataUrl && !logoDataUrl) {
				logoDataUrl = data.logoDataUrl;
				localStorage.setItem(LOGO_KEY, logoDataUrl);
				applyLogoPreview();
			}
			saveRecords();
			renderTable();
			alert("Import complete.");
		} catch (e) {
			alert("This file doesn't look like a valid backup.");
		}
	};
	reader.readAsText(file);
	els.importInput.value = "";
});

// ---------- Init ----------

applyLogoPreview();
renderTable();
clearForm();
