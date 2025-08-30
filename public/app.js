async function drawTickets(count = 1) {
  try {
    const res = await fetch(`/api/draw?count=${count}`, { method: "POST" });
    const data = await res.json();
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";

    data.results.forEach((ticket, i) => {
      const p = document.createElement("p");
      if (ticket.result === "carp") {
        p.className = "win";
        p.textContent = `🎉 Ticket #${ticket.ticketId}: WINNER — Carp!`;
      } else {
        p.className = "lose";
        p.textContent = `🎟️ Ticket #${ticket.ticketId}: Bream`;
      }
      resultsDiv.appendChild(p);
    });
  } catch (err) {
    alert("Error drawing tickets");
    console.error(err);
  }
}

document.getElementById("drawBtn").addEventListener("click", () => drawTickets(1));
document.getElementById("draw10Btn").addEventListener("click", () => drawTickets(10));
