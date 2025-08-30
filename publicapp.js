async function drawTickets(count = 1) {
  try {
    const res = await fetch(`/api/draw?count=${count}`, { method: "POST" });
    const data = await res.json();
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";

    data.results.forEach((r, i) => {
      const p = document.createElement("p");
      if (r === "carp") {
        p.className = "win";
        p.textContent = `🎉 Ticket ${i + 1}: WINNER — Carp!`;
      } else {
        p.className = "lose";
        p.textContent = `🎟️ Ticket ${i + 1}: Bream`;
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
