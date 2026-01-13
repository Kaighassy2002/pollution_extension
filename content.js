(() => {
  let data = {};

  // -------- Page 1: Vehicle + mobile --------
  if (window.location.href.includes("IssueOfPuccDetailsMobileData.xhtml")) {
  const vehicleInput = document.querySelector("#regn_noID");
  const mobile = document.querySelector("#mobileNumber");

  if (vehicleInput && mobile) {
    const vehicleNo = vehicleInput.value.trim();

    // Listen for typing in mobile number
    mobile.addEventListener("input", () => {
      const mobileValue = mobile.value.trim();
      if (mobileValue.length === 10 && vehicleNo) {
        data = { vehicleNo, mobile: mobileValue }; // ✅ match DB key
        chrome.runtime.sendMessage({ type: "COLLECT_DATA", payload: data });
        console.log("Page 1 Data Collected:", data);
      }
    });
  }
}


  // -------- Page 2: Vehicle + Date + Valid Date + Rate --------
if (window.location.href.includes("pucCertificateNew.xhtml")) {
  const vehicleNo = document.querySelector("#j_idt34")?.innerText.trim();
  const validDate = document.querySelector("#j_idt17")?.innerText.trim();
  const uptoDate = document.querySelector("#j_idt25")?.innerText.trim();
  
  const rateRaw = document.querySelector("#feesID")?.innerText.trim();
  const rate = rateRaw ? rateRaw.replace("Rs.", "").trim() : "";

  if (vehicleNo) {
    data = { vehicleNo, uptoDate, validDate, rate };
    chrome.runtime.sendMessage({ type: "COLLECT_DATA", payload: data });
    console.log("Page 2 Data Collected:", data);
  }
}

})();
