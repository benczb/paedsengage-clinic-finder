// Ask-about-clinics widget: posts the parent's question to /api/chat and
// renders the answer plus matching clinic cards. No framework, no keys in
// the browser — all intelligence lives in the Pages Function.
(function () {
  const form = document.getElementById("chatForm");
  if (!form) return;
  const input = document.getElementById("chatInput");
  const send = document.getElementById("chatSend");
  const answerEl = document.getElementById("chatAnswer");
  const resultsEl = document.getElementById("chatResults");

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function card(c) {
    const hours = (c.opening_hours || []).join("; ");
    return `<article class="card">
      <h3>${esc(c.name)}</h3>
      <p class="clinic-meta"><strong>${esc(c.area)}</strong><br />${esc(c.address)}</p>
      <p>Tel <a href="tel:+65${esc(c.phone)}">${esc(c.phone)}</a>${c.open_now !== undefined ? ` · ${c.open_now ? "Open now" : "Closed now"}` : ""}</p>
      ${hours ? `<p>${esc(hours)}</p>` : ""}
      <p><a href="${esc(c.google_maps_url)}" target="_blank" rel="noreferrer">Open in Google Maps</a> · <a href="${esc(c.page_url)}">Clinic details</a></p>
    </article>`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    send.disabled = true;
    answerEl.textContent = "Checking the clinic data…";
    resultsEl.innerHTML = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      answerEl.innerText = data.answer || "";
      resultsEl.innerHTML = (data.results || []).map(card).join("");
    } catch (err) {
      answerEl.textContent = "Sorry — the assistant couldn't answer just now. Please use the search and filters above instead.";
    } finally {
      send.disabled = false;
    }
  });
})();
