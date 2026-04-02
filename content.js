(() => {
  if (!window.location.href.includes('pucCertificateNew.xhtml')) return;

  function getText(el) {
    return ((el && (el.innerText || el.textContent)) || '').trim();
  }

  function scrapeField(primarySelector, fallbacks) {
    var selectors = [primarySelector].concat(fallbacks || []);
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        var text = getText(el);
        if (text) return { value: text, selector: selectors[i] };
      } catch (e) { /* invalid selector, skip */ }
    }
    return { value: null, selector: null };
  }

  function scrapeByRowLabel(labelText) {
    var target = (labelText || '').toLowerCase().trim();
    if (!target) return { value: null, selector: null };

    var rows = document.querySelectorAll('.row.print-heading-certificate');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var keyEl = row.querySelector('span');
      var keyText = getText(keyEl).toLowerCase();
      if (!keyText || keyText.indexOf(target) === -1) continue;

      var children = row.children ? Array.prototype.slice.call(row.children) : [];
      if (children.length >= 3) {
        var valueText = getText(children[2]);
        if (valueText && valueText !== ':') {
          return { value: valueText, selector: '.row.print-heading-certificate(' + target + ')' };
        }
      }

      var labelEl = row.querySelector('label');
      var labelTextValue = getText(labelEl);
      if (labelTextValue) {
        return { value: labelTextValue, selector: '.row.print-heading-certificate label(' + target + ')' };
      }
    }

    return { value: null, selector: null };
  }

  var vehicleResult = scrapeField('#j_idt42', [
    '#j_idt34',
    '[id$="vehicleNo"]',
    '[id*="vehicle"]',
    '[id*="registration"]'
  ]);
  if (!vehicleResult.value) {
    vehicleResult = scrapeByRowLabel('Registration No');
  }

  var validDateResult = scrapeField('#j_idt24', [
    '#j_idt17',
    '[id$="validDate"]',
    '[id*="issueDate"]',
    '[id*="date"]'
  ]);
  if (!validDateResult.value) {
    validDateResult = scrapeByRowLabel('Date');
  }

  var uptoDateResult = scrapeField('#j_idt33', [
    '#j_idt25',
    '[id$="uptoDate"]',
    '[id*="expiryDate"]',
    '[id*="validUpto"]',
    '[id*="validity"]'
  ]);
  if (!uptoDateResult.value) {
    uptoDateResult = scrapeByRowLabel('Validity upto');
  }

  var rateResult = scrapeField('#feesID', ['[id*="fees"]', '[id*="rate"]', '[id*="amount"]']);
  if (!rateResult.value) {
    rateResult = scrapeByRowLabel('Fees');
  }

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
