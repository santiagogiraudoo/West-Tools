import { useState, useMemo, useCallback, useRef } from "react";

// ─── Utility Functions ───────────────────────────────────────────────────────

function parseDateString(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function addMonths(date, months) {
  const result = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
  return result;
}

function daysBetween(d1, d2) {
  const ms = d2.getTime() - d1.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function formatARS(num) {
  if (num == null || isNaN(num)) return "—";
  return num.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Core Calculation Engine ─────────────────────────────────────────────────

function buildSchedule(principal, tna, nMonths, startDate, firstPaymentDate, fixedPayment) {
  const dailyRate = tna / 365;
  const rows = [];
  let balance = principal;
  let prevDate = startDate;

  for (let i = 1; i <= nMonths; i++) {
    const paymentDate = addMonths(firstPaymentDate, i - 1);
    const days = daysBetween(prevDate, paymentDate);
    const interest = days * dailyRate * balance;

    let principalPaid, payment, closingBalance;

    if (i === nMonths) {
      // Last payment: close out exactly
      principalPaid = balance;
      payment = balance + interest;
      closingBalance = 0;
    } else {
      payment = fixedPayment;
      principalPaid = payment - interest;
      closingBalance = balance - principalPaid;
    }

    rows.push({
      n: i,
      date: paymentDate,
      days,
      openingBalance: balance,
      payment,
      interest,
      principalPaid,
      closingBalance,
    });

    balance = closingBalance;
    prevDate = paymentDate;
  }

  return rows;
}

function solveFixedPayment(principal, tna, nMonths, startDate, firstPaymentDate) {
  // Binary search for the fixed payment that makes the balance reach ≤ 0
  // after nMonths-1 payments (last payment is adjusted)
  let lo = principal / nMonths;
  let hi = principal * 2;

  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const schedule = buildSchedule(principal, tna, nMonths, startDate, firstPaymentDate, mid);

    // Check the balance before the last payment
    if (nMonths === 1) {
      // Only one payment, the schedule handles it
      break;
    }

    const secondToLast = schedule[nMonths - 2];
    const lastRow = schedule[nMonths - 1];

    // We want the last payment to equal the fixed payment
    // If last payment > mid, fixed is too low
    // If last payment < mid, fixed is too high
    const diff = lastRow.payment - mid;

    if (Math.abs(diff) < 0.005) break;

    if (diff > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

function computeLoan(principal, tna, nMonths, startDate, firstPaymentDate) {
  if (!principal || !tna || !nMonths || !startDate || !firstPaymentDate) return null;
  if (principal <= 0 || tna <= 0 || nMonths <= 0) return null;

  const fixedPayment = nMonths === 1
    ? principal + daysBetween(startDate, firstPaymentDate) * (tna / 365) * principal
    : solveFixedPayment(principal, tna, nMonths, startDate, firstPaymentDate);

  const schedule = buildSchedule(principal, tna, nMonths, startDate, firstPaymentDate, fixedPayment);

  const totalInterest = schedule.reduce((sum, r) => sum + r.interest, 0);
  const totalPaid = schedule.reduce((sum, r) => sum + r.payment, 0);

  return { fixedPayment, totalInterest, totalPaid, schedule };
}

// ─── Scenario System ─────────────────────────────────────────────────────────

const DEFAULT_SCENARIO = {
  name: "Escenario 1",
  principal: "1641972.99",
  tna: "70",
  nMonths: "6",
  startDate: "2026-02-13",
  firstPaymentDate: "2026-03-13",
};

function createScenario(index) {
  return {
    ...DEFAULT_SCENARIO,
    name: `Escenario ${index}`,
    principal: "",
    tna: "",
    nMonths: "",
    startDate: "",
    firstPaymentDate: "",
  };
}

// ─── Components ──────────────────────────────────────────────────────────────

const FONT_LINK = "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500;600&display=swap";

export default function LoanCalculator() {
  const [scenarios, setScenarios] = useState([{ ...DEFAULT_SCENARIO }]);
  const [activeIdx, setActiveIdx] = useState(0);
  const printRef = useRef(null);

  const scenario = scenarios[activeIdx];

  const updateField = useCallback((field, value) => {
    setScenarios((prev) => {
      const next = [...prev];
      next[activeIdx] = { ...next[activeIdx], [field]: value };
      return next;
    });
  }, [activeIdx]);

  const addScenario = () => {
    const newScenario = {
      ...scenarios[activeIdx],
      name: `Escenario ${scenarios.length + 1}`,
    };
    setScenarios((prev) => [...prev, newScenario]);
    setActiveIdx(scenarios.length);
  };

  const duplicateScenario = () => {
    const dup = { ...scenarios[activeIdx], name: `${scenarios[activeIdx].name} (copia)` };
    setScenarios((prev) => [...prev, dup]);
    setActiveIdx(scenarios.length);
  };

  const removeScenario = (idx) => {
    if (scenarios.length === 1) return;
    setScenarios((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((prev) => (prev >= idx && prev > 0 ? prev - 1 : prev));
  };

  const result = useMemo(() => {
    const p = parseFloat(scenario.principal);
    const t = parseFloat(scenario.tna) / 100;
    const n = parseInt(scenario.nMonths);
    const sd = parseDateString(scenario.startDate);
    const fp = parseDateString(scenario.firstPaymentDate);
    return computeLoan(p, t, n, sd, fp);
  }, [scenario]);

  const handlePrint = () => {
    window.print();
  };

  const exportCSV = () => {
    if (!result) return;
    const headers = ["#", "Fecha", "Días", "Saldo Inicial", "Cuota", "Interés", "Capital", "Saldo Final"];
    const rows = result.schedule.map((r) =>
      [r.n, formatDate(r.date), r.days, r.openingBalance.toFixed(2), r.payment.toFixed(2), r.interest.toFixed(2), r.principalPaid.toFixed(2), r.closingBalance.toFixed(2)].join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.name.replace(/\s+/g, "_")}_amortizacion.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <link href={FONT_LINK} rel="stylesheet" />
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          --bg: #0B0F14;
          --surface: #131920;
          --surface2: #1A2230;
          --border: #243040;
          --border-focus: #3B82F6;
          --text: #E8ECF1;
          --text-dim: #8899AA;
          --text-muted: #556677;
          --accent: #3B82F6;
          --accent-glow: rgba(59, 130, 246, 0.15);
          --green: #22C55E;
          --green-dim: rgba(34, 197, 94, 0.12);
          --amber: #F59E0B;
          --amber-dim: rgba(245, 158, 11, 0.12);
          --red: #EF4444;
          --font: 'DM Sans', -apple-system, sans-serif;
          --mono: 'JetBrains Mono', 'Consolas', monospace;
        }

        .app {
          font-family: var(--font);
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          padding: 0;
        }

        /* Header */
        .header {
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          padding: 16px 28px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .logo-icon {
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, var(--accent), #6366F1);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 16px;
          color: white;
          letter-spacing: -0.5px;
        }
        .header-title {
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.3px;
        }
        .header-subtitle {
          font-size: 12px;
          color: var(--text-dim);
          margin-top: 1px;
        }
        .header-actions {
          display: flex;
          gap: 8px;
        }

        /* Buttons */
        .btn {
          font-family: var(--font);
          font-size: 13px;
          font-weight: 500;
          padding: 8px 16px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface2);
          color: var(--text);
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }
        .btn:hover { background: var(--border); border-color: var(--text-muted); }
        .btn-primary {
          background: var(--accent);
          border-color: var(--accent);
          color: white;
        }
        .btn-primary:hover { background: #2563EB; }
        .btn-sm { padding: 5px 10px; font-size: 12px; }
        .btn-icon {
          width: 32px;
          height: 32px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
        }
        .btn-danger:hover { background: rgba(239,68,68,0.15); border-color: var(--red); color: var(--red); }

        /* Tabs */
        .tabs-bar {
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          padding: 0 28px;
          display: flex;
          align-items: stretch;
          gap: 0;
          overflow-x: auto;
        }
        .tab {
          font-family: var(--font);
          font-size: 13px;
          font-weight: 500;
          padding: 10px 18px;
          border: none;
          background: none;
          color: var(--text-dim);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }
        .tab:hover { color: var(--text); }
        .tab.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }
        .tab-close {
          width: 18px;
          height: 18px;
          border-radius: 4px;
          border: none;
          background: none;
          color: var(--text-muted);
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .tab-close:hover { background: rgba(239,68,68,0.15); color: var(--red); }
        .tab-add {
          font-family: var(--font);
          font-size: 18px;
          padding: 10px 14px;
          border: none;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
        }
        .tab-add:hover { color: var(--accent); }

        /* Main layout */
        .main {
          display: grid;
          grid-template-columns: 380px 1fr;
          min-height: calc(100vh - 100px);
        }

        /* Input Panel */
        .panel-left {
          background: var(--surface);
          border-right: 1px solid var(--border);
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .panel-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .panel-section-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-muted);
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .field label {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-dim);
        }
        .field input, .field select {
          font-family: var(--mono);
          font-size: 14px;
          font-weight: 500;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--text);
          outline: none;
          transition: border-color 0.15s;
          width: 100%;
        }
        .field input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
        .field input::placeholder { color: var(--text-muted); }
        .field-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .scenario-name-input {
          font-family: var(--font) !important;
          font-size: 15px !important;
          font-weight: 600 !important;
          background: transparent !important;
          border: 1px solid transparent !important;
          padding: 6px 8px !important;
          color: var(--text) !important;
          border-radius: 6px;
        }
        .scenario-name-input:hover { border-color: var(--border) !important; }
        .scenario-name-input:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accent-glow) !important; }

        /* Summary Cards */
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          padding: 24px 28px;
        }
        .summary-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 18px 20px;
        }
        .summary-card-label {
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-dim);
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .summary-card-value {
          font-family: var(--mono);
          font-size: 20px;
          font-weight: 600;
          letter-spacing: -0.5px;
        }
        .summary-card-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
        }
        .val-blue { color: var(--accent); }
        .val-green { color: var(--green); }
        .val-amber { color: var(--amber); }

        /* Table */
        .table-container {
          padding: 0 28px 28px;
          overflow-x: auto;
        }
        .table-header-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 28px;
          margin-bottom: 12px;
        }
        .table-title {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.2px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        thead th {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-muted);
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          text-align: right;
          white-space: nowrap;
          position: sticky;
          top: 0;
          background: var(--bg);
          z-index: 5;
        }
        thead th:first-child { text-align: center; width: 44px; }
        thead th:nth-child(2) { text-align: left; }
        tbody td {
          font-family: var(--mono);
          font-size: 13px;
          font-weight: 400;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(36, 48, 64, 0.5);
          text-align: right;
          white-space: nowrap;
        }
        tbody td:first-child {
          text-align: center;
          color: var(--text-muted);
          font-weight: 500;
        }
        tbody td:nth-child(2) {
          text-align: left;
          color: var(--text-dim);
        }
        tbody tr:hover { background: rgba(59, 130, 246, 0.04); }
        tbody tr:last-child td { border-bottom: none; }

        .td-interest { color: var(--amber); }
        .td-principal { color: var(--green); }
        .td-zero { color: var(--green); font-weight: 600; }

        /* Totals row */
        tfoot td {
          font-family: var(--mono);
          font-size: 13px;
          font-weight: 600;
          padding: 12px 14px;
          border-top: 2px solid var(--border);
          text-align: right;
        }
        tfoot td:first-child, tfoot td:nth-child(2), tfoot td:nth-child(3) { text-align: left; }

        /* Empty state */
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 40px;
          color: var(--text-muted);
          text-align: center;
          gap: 12px;
        }
        .empty-icon {
          font-size: 40px;
          opacity: 0.4;
          margin-bottom: 4px;
        }
        .empty-state p { font-size: 14px; max-width: 320px; line-height: 1.6; }

        /* Print styles */
        @media print {
          .no-print { display: none !important; }
          .app { background: white; color: black; }
          .main { display: block; }
          .panel-left { display: none; }
          .summary-grid { padding: 12px 0; }
          .summary-card { background: white; border: 1px solid #ddd; }
          .summary-card-value { color: black !important; }
          .summary-card-label { color: #666; }
          .table-container { padding: 0; }
          table { font-size: 11px; }
          thead th { background: white; color: #333; border-bottom: 2px solid #333; }
          tbody td { color: black; border-bottom: 1px solid #ddd; }
          .td-interest { color: #996600; }
          .td-principal { color: #006600; }
          tfoot td { border-top: 2px solid #333; }
          .print-header { display: block !important; padding: 20px 0; border-bottom: 2px solid #333; margin-bottom: 16px; }
          .print-header h1 { font-size: 20px; margin-bottom: 12px; }
          .print-info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px; }
          .print-info span { color: #666; }
        }

        /* Responsive */
        @media (max-width: 900px) {
          .main { grid-template-columns: 1fr; }
          .panel-left { border-right: none; border-bottom: 1px solid var(--border); }
          .summary-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="app">
        {/* ─── Header ─── */}
        <div className="header no-print">
          <div className="header-left">
            <div className="logo-icon">$</div>
            <div>
              <div className="header-title">Calculadora de Préstamos</div>
              <div className="header-subtitle">Simulador de cuotas fijas con interés por días</div>
            </div>
          </div>
          <div className="header-actions">
            <button className="btn" onClick={exportCSV} disabled={!result}>
              ⬇ CSV
            </button>
            <button className="btn" onClick={handlePrint} disabled={!result}>
              🖨 Imprimir
            </button>
          </div>
        </div>

        {/* ─── Scenario Tabs ─── */}
        <div className="tabs-bar no-print">
          {scenarios.map((s, i) => (
            <button
              key={i}
              className={`tab ${i === activeIdx ? "active" : ""}`}
              onClick={() => setActiveIdx(i)}
            >
              {s.name}
              {scenarios.length > 1 && (
                <span
                  className="tab-close"
                  onClick={(e) => { e.stopPropagation(); removeScenario(i); }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button className="tab-add" onClick={addScenario} title="Nuevo escenario">+</button>
        </div>

        {/* ─── Main Layout ─── */}
        <div className="main">
          {/* ─── Input Panel ─── */}
          <div className="panel-left no-print">
            <div className="panel-section">
              <input
                className="scenario-name-input"
                value={scenario.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Nombre del escenario"
              />
            </div>

            <div className="panel-section">
              <div className="panel-section-title">Datos del Préstamo</div>

              <div className="field">
                <label>Monto del Préstamo (ARS)</label>
                <input
                  type="number"
                  value={scenario.principal}
                  onChange={(e) => updateField("principal", e.target.value)}
                  placeholder="1,641,972.99"
                  step="0.01"
                  min="0"
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label>TNA (%)</label>
                  <input
                    type="number"
                    value={scenario.tna}
                    onChange={(e) => updateField("tna", e.target.value)}
                    placeholder="70"
                    step="0.1"
                    min="0"
                    max="999"
                  />
                </div>
                <div className="field">
                  <label>Meses</label>
                  <input
                    type="number"
                    value={scenario.nMonths}
                    onChange={(e) => updateField("nMonths", e.target.value)}
                    placeholder="6"
                    min="1"
                    max="36"
                  />
                </div>
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-section-title">Fechas</div>
              <div className="field">
                <label>Fecha de Inicio</label>
                <input
                  type="date"
                  value={scenario.startDate}
                  onChange={(e) => updateField("startDate", e.target.value)}
                />
              </div>
              <div className="field">
                <label>Fecha del Primer Pago</label>
                <input
                  type="date"
                  value={scenario.firstPaymentDate}
                  onChange={(e) => updateField("firstPaymentDate", e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
              <button className="btn" onClick={duplicateScenario} style={{ flex: 1 }}>
                ⧉ Duplicar escenario
              </button>
            </div>
          </div>

          {/* ─── Output Panel ─── */}
          <div style={{ overflow: "auto" }}>
            {/* Print-only header */}
            <div className="print-header" style={{ display: "none" }}>
              <h1>Simulación de Préstamo — {scenario.name}</h1>
              <div className="print-info">
                <div><span>Monto:</span> {formatARS(parseFloat(scenario.principal))}</div>
                <div><span>TNA:</span> {scenario.tna}%</div>
                <div><span>Plazo:</span> {scenario.nMonths} meses</div>
                <div><span>Inicio:</span> {scenario.startDate}</div>
                <div><span>1er pago:</span> {scenario.firstPaymentDate}</div>
              </div>
            </div>

            {result ? (
              <>
                {/* Summary cards */}
                <div className="summary-grid">
                  <div className="summary-card">
                    <div className="summary-card-label">Cuota Fija Mensual</div>
                    <div className="summary-card-value val-blue">
                      {formatARS(result.fixedPayment)}
                    </div>
                    <div className="summary-card-sub">
                      {scenario.nMonths} cuotas iguales*
                    </div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-card-label">Total Intereses</div>
                    <div className="summary-card-value val-amber">
                      {formatARS(result.totalInterest)}
                    </div>
                    <div className="summary-card-sub">
                      {((result.totalInterest / parseFloat(scenario.principal)) * 100).toFixed(1)}% del capital
                    </div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-card-label">Total a Pagar</div>
                    <div className="summary-card-value val-green">
                      {formatARS(result.totalPaid)}
                    </div>
                    <div className="summary-card-sub">
                      Capital + intereses
                    </div>
                  </div>
                </div>

                {/* Schedule table */}
                <div className="table-header-bar">
                  <div className="table-title">Cronograma de Amortización</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    *Última cuota ajustada para cerrar saldo exacto
                  </div>
                </div>
                <div className="table-container" ref={printRef}>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Fecha</th>
                        <th>Días</th>
                        <th>Saldo Inicial</th>
                        <th>Cuota</th>
                        <th>Interés</th>
                        <th>Capital</th>
                        <th>Saldo Final</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.schedule.map((r) => (
                        <tr key={r.n}>
                          <td>{r.n}</td>
                          <td>{formatDate(r.date)}</td>
                          <td>{r.days}</td>
                          <td>{formatARS(r.openingBalance)}</td>
                          <td>{formatARS(r.payment)}</td>
                          <td className="td-interest">{formatARS(r.interest)}</td>
                          <td className="td-principal">{formatARS(r.principalPaid)}</td>
                          <td className={r.closingBalance === 0 ? "td-zero" : ""}>
                            {formatARS(r.closingBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td></td>
                        <td style={{ textAlign: "left", color: "var(--text-dim)" }}>TOTAL</td>
                        <td></td>
                        <td></td>
                        <td>{formatARS(result.totalPaid)}</td>
                        <td className="td-interest">{formatARS(result.totalInterest)}</td>
                        <td className="td-principal">{formatARS(parseFloat(scenario.principal))}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <p>Ingresá los datos del préstamo en el panel izquierdo para ver la simulación.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
