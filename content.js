(() => {
  if (!window.location.href.includes('pucCertificateNew.xhtml')) return;

  function scrapeField(primarySelector, fallbacks) {
    var selectors = [primarySelector].concat(fallbacks || []);
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        var text = (el && (el.innerText || el.textContent) || '').trim();
        if (text) return { value: text, selector: selectors[i] };
      } catch (e) { /* invalid selector, skip */ }
    }
    return { value: null, selector: null };
  }

  var vehicleResult   = scrapeField('#j_idt34',  ['[id$="vehicleNo"]', '[id*="vehicle"]']);
  var validDateResult = scrapeField('#j_idt17',   ['[id$="validDate"]', '[id*="issueDate"]']);
  var uptoDateResult  = scrapeField('#j_idt25',   ['[id$="uptoDate"]',  '[id*="expiryDate"]', '[id*="validUpto"]']);
  var rateResult      = scrapeField('#feesID',    ['[id*="fees"]', '[id*="rate"]', '[id*="amount"]']);

  var vehicleNo = vehicleResult.value;
  if (!vehicleNo) return;

  var rawRate = (rateResult.value || '').replace(/Rs\.?\s*/i, '').trim();
  var missingFields = [];
  if (!validDateResult.value) missingFields.push('validDate');
  if (!uptoDateResult.value)  missingFields.push('uptoDate');

  chrome.runtime.sendMessage({
    type: 'SCRAPED_DATA',
    payload: {
      vehicleNo:    vehicleNo,
      validDate:    validDateResult.value,
      uptoDate:     uptoDateResult.value,
      rate:         rawRate,
      missingFields: missingFields
    }
  });
})();
