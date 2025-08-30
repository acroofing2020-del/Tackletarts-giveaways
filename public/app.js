async function drawTickets(count = 1) {
  try {
    const res = await fetch(`/api/draw?count=${count}`, { method: "POST" });
    if (!res.ok) {
      if (res.status === 401) {
        alert("You must log in first!");
        window.location = "/login.html";
        return;
      }
      throw new Error("Request failed");
    }

    const data = await res.json();
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";

    data.results.forEach((ticket) => {
      const card = document.createElement("div");
      card.className = "ticket-card";

      const img = document.createElement("img");
      img.width = 150;

      if (ticket.result === "carp") {
        card.classList.add("win");
        img.src = "/images/carp.png";
        img.alt = "Carp";
        card.innerHTML = `<h3>🎉 Ticket #${ticket.ticketId}: WINNER!</h3>`;
      } else {
        card.classList.add("lose");
        img.src = "/images/bream.png";
        img.alt = "Bream";
        card.innerHTML = `<h3>🎟️ Ticket #${ticket.ticketId}: Bream</h3>`;
      }

      card.appendChild(img);
      resultsDiv.appendChild(card);
    });
  } catch (err) {
    alert("Error drawing tickets");
    console.error(err);
  }
}

document.getElementById("drawBtn").addEventListener("click", () =>
  drawTickets(1)
);
document.getElementById("draw10Btn").addEventListener("click", () =>
  drawTickets(10)
);
