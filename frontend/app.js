// Point to the backend server (ensure your backend is running on this port)
const API_URL = 'http://localhost:3002/api/generate';


document.getElementById('analysisForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const age = document.getElementById('age').value;
    const city = document.getElementById('city').value;
    const reportText = document.getElementById('reportText').value;

    if (!reportText.trim()) {
        alert('Please describe your medical report');
        return;
    }

    showLoading();

    try {
        const prompt = `You are an expert medical AI assistant. Analyze the following medical report.

Patient Details:
- Name: ${name}
- Age: ${age} years
- Location: ${city}

Medical Report: ${reportText}

Provide analysis in this EXACT JSON format (no markdown, no extra text):

{
  "symptoms": ["symptom1", "symptom2", "symptom3"],
  "possibleConditions": [
    {
      "name": "Condition name",
      "severity": "Mild",
      "description": "Brief explanation"
    }
  ],
  "temporaryMeds": [
    {
      "name": "Medication name",
      "dosage": "500mg",
      "frequency": "Twice daily",
      "notes": "Consult doctor first"
    }
  ],
  "dietPlan": {
    "recommended": ["food1", "food2", "food3"],
    "avoid": ["food1", "food2"]
  },
  "doctors": [
    {
      "specialization": "Specialist type",
      "city": "${city}",
      "notes": "Why recommended"
    }
  ]
}`;

        console.log('Sending request to:', API_URL);

        // Helper: sleep
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Helper: perform fetch with retries and exponential backoff
        async function generateWithRetry(promptText, opts = {}) {
            const maxAttempts = opts.maxAttempts || 4;
            const baseDelay = opts.baseDelay || 2000; // ms
            const timeoutMs = opts.timeoutMs || 30000; // per-request timeout

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                // per-attempt abort controller
                const controller = new AbortController();
                const tid = setTimeout(() => controller.abort(), timeoutMs);

                try {
                    const resp = await fetch(API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: promptText }),
                        signal: controller.signal
                    });

                    clearTimeout(tid);

                    const text = await resp.text().catch(() => '');

                    // Try parse JSON body if present
                    let bodyObj = null;
                    try { bodyObj = text ? JSON.parse(text) : null; } catch (_) { bodyObj = null; }

                    if (!resp.ok) {
                        // handle rate limit
                        const retryAfter = (bodyObj && (bodyObj.retryAfterSeconds || bodyObj.retryAfter || (bodyObj.error && bodyObj.error.retryAfterSeconds))) || null;
                        if (resp.status === 429 || retryAfter) {
                            const waitSec = retryAfter || Math.ceil((baseDelay * Math.pow(2, attempt - 1)) / 1000);
                            console.warn(`Rate limited. Attempt ${attempt} of ${maxAttempts}. Waiting ${waitSec}s before retry.`);
                            if (attempt === maxAttempts) {
                                // Surface final error
                                const err = new Error(`Rate limit exceeded. Try again in ${waitSec} seconds.`);
                                err.retryAfterSeconds = waitSec;
                                throw err;
                            }
                            await sleep((retryAfter ? retryAfter : Math.ceil(baseDelay * Math.pow(2, attempt - 1) / 1000)) * 1000 + Math.random() * 500);
                            continue; // retry
                        }

                        // non-retryable error
                        throw new Error(`Server error: ${resp.status} ${text}`);
                    }

                    // success - ensure JSON
                    const ct = resp.headers.get('content-type') || '';
                    if (!ct.includes('application/json')) {
                        throw new Error('Invalid response from server. Expected JSON.');
                    }

                    // parsed bodyObj already
                    return bodyObj;

                } catch (err) {
                    clearTimeout(tid);
                    // Abort error -> network timeout, eligible for retry
                    if (err.name === 'AbortError') {
                        if (attempt === maxAttempts) throw new Error('Request timed out. Please try again.');
                        await sleep(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500);
                        continue;
                    }

                    // If error has retryAfterSeconds, surface
                    if (err && err.retryAfterSeconds) {
                        throw err; // already handled above
                    }

                    // Other network errors - retry a few times
                    if (attempt < maxAttempts) {
                        await sleep(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500);
                        continue;
                    }
                    throw err;
                }
            }
            throw new Error('Failed to get response after retries');
        }

        // Call the helper to get parsed JSON response
        const data = await generateWithRetry(prompt, { maxAttempts: 4, baseDelay: 2000, timeoutMs: 30000 });

        console.log('Received data:', data);

        if (!data || data.success === false) {
            throw new Error((data && data.message) || 'Analysis failed');
        }

        // Parse AI response
        let analysisResult;
        try {
            let cleanText = (data.response || '').trim();

            // Remove surrounding triple-backtick fences (``` or ```json) if present
            if (cleanText.startsWith('```')) {
                // Remove opening fence like ``` or ```json and the closing fence at the end
                cleanText = cleanText.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
            }

            // Also remove surrounding single backticks if present
            if (cleanText.startsWith('`') && cleanText.endsWith('`')) {
                cleanText = cleanText.replace(/^`+|`+$/g, '').trim();
            }

            console.log('Clean text:', cleanText);
            analysisResult = JSON.parse(cleanText);

        } catch (parseError) {
            console.error('Parse error:', parseError);
            console.error('Response was:', data.response);
            throw new Error('Failed to parse AI response. Please try again.');
        }

        // Display resultsnp
        displayResults(name, age, city, analysisResult);
        hideLoading();
        document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        hideLoading();
        console.error('Full error:', error);
        alert('Error: ' + error.message + '\n\nCheck browser console (F12) for details.');
    }
});

function showLoading() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('btnText').classList.add('hidden');
    document.getElementById('btnLoader').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('analyzeBtn').disabled = false;
    document.getElementById('btnText').classList.remove('hidden');
    document.getElementById('btnLoader').classList.add('hidden');
}

function displayResults(name, age, city, data) {
    document.getElementById('resultsSection').classList.remove('hidden');
    
    // Patient info
    document.getElementById('patientName').textContent = name;
    document.getElementById('patientAge').textContent = age;
    document.getElementById('patientCity').textContent = city;

    // Symptoms
    const symptomsList = document.getElementById('symptomsList');
    symptomsList.innerHTML = data.symptoms.map(symptom => 
        `<li>${symptom}</li>`
    ).join('');

    // Conditions
    const conditionsList = document.getElementById('conditionsList');
    conditionsList.innerHTML = data.possibleConditions.map(condition => `
        <div class="condition-item" style="border-left: 2px solid #1E90FF; padding-left: 1rem; margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <strong>${condition.name}</strong>
                <span style="background: #FEF3C7; color: #92400E; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem;">
                    ${condition.severity}
                </span>
            </div>
            <p style="font-size: 0.875rem; color: #6B7280;">${condition.description}</p>
        </div>
    `).join('');

    // Medications
    const medicationsList = document.getElementById('medicationsList');
    medicationsList.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Medication</th>
                    <th>Dosage</th>
                    <th>Frequency</th>
                    <th>Notes</th>
                </tr>
            </thead>
            <tbody>
                ${data.temporaryMeds.map(med => `
                    <tr>
                        <td>${med.name}</td>
                        <td>${med.dosage}</td>
                        <td>${med.frequency}</td>
                        <td>${med.notes || '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Diet
    document.getElementById('recommendedFoods').innerHTML = 
        data.dietPlan.recommended.map(food => `<li>${food}</li>`).join('');
    
    document.getElementById('avoidFoods').innerHTML = 
        data.dietPlan.avoid.map(food => `<li>${food}</li>`).join('');

    // Doctors
    const doctorsList = document.getElementById('doctorsList');
    doctorsList.innerHTML = data.doctors.map(doctor => `
        <div class="doctor-card">
            <div style="font-weight: 600; margin-bottom: 0.5rem;">${doctor.specialization}</div>
            <div style="font-size: 0.875rem; color: #6B7280; margin-bottom: 0.5rem;">${doctor.city}</div>
            <div style="font-size: 0.75rem; color: #6B7280; margin-bottom: 0.75rem;">${doctor.notes}</div>
            <button onclick="findDoctors('${doctor.specialization}', '${doctor.city}')" 
                    style="width: 100%; padding: 0.5rem; background: #F3F4F6; color: #1E90FF; border: 1px solid #E5E7EB; border-radius: 6px; cursor: pointer;">
                Find Doctors
            </button>
        </div>
    `).join('');
}

function findDoctors(specialization, city) {
    const query = `${specialization} doctors in ${city}`;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
}

function resetForm() {
    document.getElementById('analysisForm').reset();
    document.getElementById('resultsSection').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
