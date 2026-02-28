(() => {
  // -------- Page 2: Vehicle + Date + Valid Date + Rate --------
  // Scraping only happens on the second page
  if (window.location.href.includes("pucCertificateNew.xhtml")) {
    const vehicleNo = document.querySelector("#j_idt34")?.innerText.trim();
    const validDate = document.querySelector("#j_idt17")?.innerText.trim();
    const uptoDate = document.querySelector("#j_idt25")?.innerText.trim();
    
    const rateRaw = document.querySelector("#feesID")?.innerText.trim();
    const rate = rateRaw ? rateRaw.replace("Rs.", "").trim() : "";

    if (vehicleNo) {
      const data = { vehicleNo, uptoDate, validDate, rate };
      chrome.runtime.sendMessage({ type: "SCRAPED_DATA", payload: data });
      console.log("Page 2 Data Scraped:", data);
    }
  }
})();
