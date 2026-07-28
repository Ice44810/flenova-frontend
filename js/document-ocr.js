/**
 * Extraction OCR des dates d'expiration — pré-remplissage formulaires.
 */
async function extractDocumentExpiry(file, docType) {
    if (!file) return null;
    const formData = new FormData();
    formData.append('document', file);
    formData.append('doc_type', docType);
    const res = await apiFetch('documents/extract-expiry', { method: 'POST', body: formData });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Extraction impossible');
    }
    const json = await res.json();
    return json.data;
}

function showOcrHint(elementId, message, confidence) {
    let el = document.getElementById(elementId);
    if (!el) {
        el = document.createElement('p');
        el.id = elementId;
        el.className = 'text-xs mt-1';
    }
    const color = confidence >= 60 ? 'text-green-600' : (confidence >= 30 ? 'text-amber-600' : 'text-gray-500');
    el.className = `text-xs mt-1 ${color}`;
    el.textContent = message;
    return el;
}

async function handleDocumentOcrUpload(fileInput, expiryInputId, docType, hintContainerId) {
    const file = fileInput?.files?.[0];
    if (!file) return;

    const hintHost = document.getElementById(hintContainerId);
    if (hintHost) {
        hintHost.innerHTML = '<p class="text-xs text-blue-500 mt-1"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Analyse du document…</p>';
    }

    try {
        const data = await extractDocumentExpiry(file, docType);
        const expiryInput = document.getElementById(expiryInputId);
        if (data.expiryDate && expiryInput && (!expiryInput.value || confirm(`Date détectée : ${data.expiryDate} (confiance ${data.confidence}%). Remplacer la date actuelle ?`))) {
            expiryInput.value = data.expiryDate;
        }
        if (hintHost) {
            hintHost.innerHTML = '';
            hintHost.appendChild(showOcrHint(
                `${hintContainerId}-msg`,
                data.message || 'Analyse terminée',
                data.confidence || 0
            ));
        } else {
            showToast(data.message || 'Document analysé', data.expiryDate ? 'success' : 'info');
        }
    } catch (err) {
        if (hintHost) {
            hintHost.innerHTML = `<p class="text-xs text-red-500 mt-1">${err.message}</p>`;
        } else {
            showToast(err.message, 'error');
        }
    }
}

window.extractDocumentExpiry = extractDocumentExpiry;
window.handleDocumentOcrUpload = handleDocumentOcrUpload;
