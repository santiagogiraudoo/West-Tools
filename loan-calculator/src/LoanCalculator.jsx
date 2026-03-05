import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";

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

function formatCurrency(num, currency = "ARS") {
  if (num == null || isNaN(num)) return "—";
  const formatted = num.toLocaleString(currency === "USD" ? "en-US" : "es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return formatted.replace(/\s/g, "");
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
  principal: "",
  tna: "",
  nMonths: "",
  startDate: "",
  firstPaymentDate: "",
  currency: "ARS",
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
    currency: "ARS",
  };
}

// ─── Components ──────────────────────────────────────────────────────────────

const FONT_LINK = "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500;600&display=swap";

export default function LoanCalculator() {
  const [scenarios, setScenarios] = useState([{ ...DEFAULT_SCENARIO }]);
  const [activeIdx, setActiveIdx] = useState(0);
  const printRef = useRef(null);

  const scenario = scenarios[activeIdx];
  const fmt = (num) => formatCurrency(num, scenario.currency);
  const currLabel = scenario.currency === "USD" ? "USD" : "ARS";

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

  const exportExcel = () => {
    if (!result) return;

    const r = Math.round;
    const rows = [];

    // Title
    rows.push(["WestCredito - Cronograma de Amortización"]);
    rows.push([]);

    // Metadata
    rows.push(["Escenario", scenario.name]);
    rows.push(["Moneda", scenario.currency]);
    rows.push(["Monto del Préstamo", r(parseFloat(scenario.principal))]);
    rows.push(["TNA (%)", `${scenario.tna}%`]);
    rows.push(["Plazo", `${scenario.nMonths} meses`]);
    rows.push(["Fecha de Inicio", scenario.startDate]);
    rows.push(["Fecha Primer Pago", scenario.firstPaymentDate]);
    rows.push(["Cuota Fija Mensual", r(result.fixedPayment)]);
    rows.push(["Total Intereses", r(result.totalInterest)]);
    rows.push(["Total a Pagar", r(result.totalPaid)]);
    rows.push([]);

    // Table headers
    rows.push(["#", "Fecha", "Días", "Saldo Inicial", "Cuota", "Interés", "Capital", "Saldo Final"]);

    // Schedule data
    result.schedule.forEach((row) => {
      rows.push([
        row.n,
        formatDate(row.date),
        row.days,
        r(row.openingBalance),
        r(row.payment),
        r(row.interest),
        r(row.principalPaid),
        r(row.closingBalance),
      ]);
    });

    // Totals row
    rows.push([]);
    rows.push(["", "TOTAL", "", "", r(result.totalPaid), r(result.totalInterest), r(parseFloat(scenario.principal)), ""]);

    // Create workbook
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws["!cols"] = [
      { wch: 5 },   // #
      { wch: 14 },  // Fecha
      { wch: 6 },   // Días
      { wch: 18 },  // Saldo Inicial
      { wch: 16 },  // Cuota
      { wch: 16 },  // Interés
      { wch: 16 },  // Capital
      { wch: 18 },  // Saldo Final
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, scenario.name.slice(0, 31));
    XLSX.writeFile(wb, `WestCredito_${scenario.name.replace(/\s+/g, "_")}_${scenario.startDate}.xlsx`);
  };

  return (
    <>
      <link href={FONT_LINK} rel="stylesheet" />
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          --bg: #0A0608;
          --surface: #140A10;
          --surface2: #1C0F16;
          --border: #2D1520;
          --border-focus: #630330;
          --text: #F0E6EB;
          --text-dim: #A0889A;
          --text-muted: #6B4F63;
          --accent: #8B1A4A;
          --accent-glow: rgba(99, 3, 48, 0.25);
          --green: #D4A853;
          --green-dim: rgba(212, 168, 83, 0.12);
          --amber: #C97D4F;
          --amber-dim: rgba(201, 125, 79, 0.12);
          --red: #EF4444;
          --brand: #630330;
          --font: 'DM Sans', -apple-system, sans-serif;
          --mono: 'JetBrains Mono', 'Consolas', monospace;
        }

        .app {
          font-family: var(--font);
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          padding: 0;
          width: 100%;
          overflow-x: hidden;
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
          height: 38px;
          display: flex;
          align-items: center;
        }
        .logo-icon img {
          height: 38px;
          width: 38px;
          object-fit: cover;
          border-radius: 8px;
        }
        .logo-text {
          font-size: 20px;
          letter-spacing: -0.3px;
          line-height: 1;
        }
        .logo-text-bold {
          font-weight: 700;
          color: var(--text);
          text-transform: lowercase;
        }
        .logo-text-light {
          font-weight: 300;
          color: var(--text-dim);
          text-transform: lowercase;
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
        .btn-primary:hover { background: #630330; }
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
          width: 100%;
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
        .panel-right {
          overflow-x: auto;
          min-width: 0;
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

        .currency-toggle {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }
        .currency-btn {
          font-family: var(--mono);
          font-size: 13px;
          font-weight: 500;
          padding: 9px 12px;
          border: none;
          background: var(--bg);
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .currency-btn:first-child {
          border-right: 1px solid var(--border);
        }
        .currency-btn.active {
          background: var(--accent);
          color: white;
          font-weight: 600;
        }
        .currency-btn:hover:not(.active) {
          background: var(--surface2);
          color: var(--text-dim);
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
        .val-blue { color: #D4A853; }
        .val-green { color: #E8B4B8; }
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
          border-bottom: 1px solid rgba(45, 21, 32, 0.5);
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
        tbody tr:hover { background: rgba(99, 3, 48, 0.08); }
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
          @page { margin: 0; }
          .no-print { display: none !important; }
          .app {
            background: white !important;
            color: black !important;
            min-height: auto !important;
            padding: 15mm 18mm !important;
          }
          .main {
            display: block !important;
          }
          .panel-left { display: none !important; }
          .panel-right { overflow: visible !important; }
          .summary-grid { padding: 14px 0; gap: 8px; }
          .summary-card { background: white; border: 1px solid #bbb; break-inside: avoid; padding: 12px 14px; }
          .summary-card-value { color: black !important; font-size: 16px; }
          .summary-card-label { color: #555; font-size: 10px; }
          .summary-card-sub { color: #777; font-size: 10px; }
          .table-container { padding: 0 !important; overflow: visible !important; }
          .table-header-bar { padding: 0 !important; margin-bottom: 6px; }
          .table-title { color: black; font-size: 13px; }
          table { font-size: 10px; }
          thead th { background: white !important; color: #333; border-bottom: 2px solid #333; position: static !important; font-size: 9px; padding: 6px 8px; }
          tbody td { color: black; border-bottom: 1px solid #ddd; padding: 5px 8px; font-size: 10px; }
          .td-interest { color: #996633; }
          .td-principal { color: #8B6914; }
          .td-zero { color: #2e7d32; }
          tfoot td { border-top: 2px solid #333; color: black; padding: 6px 8px; font-size: 10px; }
          .print-header { display: block !important; padding: 0 0 14px 0; border-bottom: 2px solid #333; margin-bottom: 14px; }
          .print-header h1 { font-size: 16px; margin-bottom: 8px; color: black; }
          .print-info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 12px; font-size: 10px; }
          .print-info div { color: black; }
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
            <div className="logo-icon">
              <img src={`${import.meta.env.BASE_URL}wlogo.png`} alt="WestCredito" />
            </div>
            <div className="logo-text">
              <span className="logo-text-bold">west</span>
              <span className="logo-text-light">credito</span>
            </div>
          </div>
          <div className="header-actions">
            <button className="btn" onClick={exportExcel} disabled={!result}>
              ⬇ Excel
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
                <label>Moneda</label>
                <div className="currency-toggle">
                  <button
                    className={`currency-btn ${scenario.currency === "ARS" ? "active" : ""}`}
                    onClick={() => updateField("currency", "ARS")}
                  >
                    $ ARS
                  </button>
                  <button
                    className={`currency-btn ${scenario.currency === "USD" ? "active" : ""}`}
                    onClick={() => updateField("currency", "USD")}
                  >
                    US$ USD
                  </button>
                </div>
              </div>

              <div className="field">
                <label>Monto del Préstamo ({currLabel})</label>
                <input
                  type="number"
                  value={scenario.principal}
                  onChange={(e) => updateField("principal", e.target.value)}
                  placeholder={scenario.currency === "USD" ? "1000" : "1000000"}
                  step="1"
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
                    placeholder={scenario.currency === "USD" ? "18" : "70"}
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
          <div className="panel-right">
            {/* Print-only header */}
            <div className="print-header" style={{ display: "none" }}>
              <h1>WestCredito — {scenario.name}</h1>
              <div className="print-info">
                <div><span>Moneda:</span> {currLabel}</div>
                <div><span>Monto:</span> {fmt(parseFloat(scenario.principal))}</div>
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
                      {fmt(result.fixedPayment)}
                    </div>
                    <div className="summary-card-sub">
                      {scenario.nMonths} cuotas iguales*
                    </div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-card-label">Total Intereses</div>
                    <div className="summary-card-value val-amber">
                      {fmt(result.totalInterest)}
                    </div>
                    <div className="summary-card-sub">
                      {((result.totalInterest / parseFloat(scenario.principal)) * 100).toFixed(1)}% del capital
                    </div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-card-label">Total a Pagar</div>
                    <div className="summary-card-value val-green">
                      {fmt(result.totalPaid)}
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
                          <td>{fmt(r.openingBalance)}</td>
                          <td>{fmt(r.payment)}</td>
                          <td className="td-interest">{fmt(r.interest)}</td>
                          <td className="td-principal">{fmt(r.principalPaid)}</td>
                          <td className={r.closingBalance === 0 ? "td-zero" : ""}>
                            {fmt(r.closingBalance)}
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
                        <td>{fmt(result.totalPaid)}</td>
                        <td className="td-interest">{fmt(result.totalInterest)}</td>
                        <td className="td-principal">{fmt(parseFloat(scenario.principal))}</td>
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
