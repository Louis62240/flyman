const JSON_FILE = 'vols_ete_2026.json';
const monthNames = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

let allData = [];
let availableMonths = [];
let currentMonthIndex = 0;

let maxPrice = 1000;
let selectedDepart = 'all';
let selectedAirline = 'all';

function toggleAccordion(id) {
    const content = document.getElementById(id);
    if (content.classList.contains('d-none')) {
        content.classList.remove('d-none');
    } else {
        content.classList.add('d-none');
    }
}

function updatePriceLabel() {
    document.getElementById('price-val').innerText = document.getElementById('price-filter').value;
}

function applyFilters() {
    maxPrice = parseInt(document.getElementById('price-filter').value, 10);
    selectedDepart = document.getElementById('depart-filter').value;
    selectedAirline = document.getElementById('airline-filter').value;
    updateView();
}

function initFilters(data) {
    let departs = new Set();
    let airlines = new Set();
    let highestPrice = 0;

    data.forEach(v => {
        departs.add(v.depart);
        airlines.add(v.compagnie);
        if (v.prix > highestPrice) highestPrice = v.prix;
    });

    highestPrice = Math.ceil(highestPrice / 10) * 10;
    const priceInput = document.getElementById('price-filter');
    priceInput.max = highestPrice;
    priceInput.value = highestPrice;
    maxPrice = highestPrice;
    updatePriceLabel();

    const departSelect = document.getElementById('depart-filter');
    Array.from(departs).sort().forEach(d => {
        departSelect.innerHTML += `<option value="${d}">${d}</option>`;
    });

    const airlineSelect = document.getElementById('airline-filter');
    Array.from(airlines).sort().forEach(a => {
        airlineSelect.innerHTML += `<option value="${a}">${a}</option>`;
    });
}

function generateCalendar(vols, year, month) {
    const flightMap = {};
    vols.forEach(v => {
        const [aller, retour] = v.id_date.split(' > ');
        const [d] = aller.split('.');
        const [retourD] = retour.split('.');
        const dayNum = parseInt(d, 10);

        if (!flightMap[dayNum] || v.prix < flightMap[dayNum].prix) {
            flightMap[dayNum] = { ...v, retourJour: retourD };
        }
    });

    let html = `<div class="calendar-month mt-2">`;
    html += `<div class="grid-cols-7 grid-header text-small text-center">
                <div>L</div><div>M</div><div>M</div><div>J</div><div>V</div>
                <div class="weekend-header">S</div><div class="weekend-header">D</div>
             </div>`;
    html += `<div class="grid-cols-7 text-small">`;

    const firstDay = new Date(year, month - 1, 1).getDay();
    const startDay = firstDay === 0 ? 7 : firstDay;
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 1; i < startDay; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dayOfWeek = (d + startDay - 2) % 7 + 1;
        const isWeekend = dayOfWeek === 6 || dayOfWeek === 7;
        const bgClass = isWeekend ? 'weekend-bg' : '';

        if (flightMap[d]) {
            const prix = flightMap[d].prix.toFixed(0);
            const retourJour = flightMap[d].retourJour;

            html += `
                <div class="calendar-day has-flight" title="Retour le ${retourJour}">
                    <div class="day-num">${d}</div>
                    <div class="return-info">↳ ${retourJour}</div>
                    <div class="calendar-price">${prix} €</div>
                </div>
            `;
        } else {
            html += `
                <div class="calendar-day normal-day ${bgClass}">
                    <span>${d}</span>
                </div>
            `;
        }
    }

    html += `</div></div>`;
    return html;
}

function changeMonth(step) {
    currentMonthIndex += step;
    if (currentMonthIndex < 0) currentMonthIndex = 0;
    if (currentMonthIndex >= availableMonths.length) currentMonthIndex = availableMonths.length - 1;
    updateView();
}

function updateView() {
    if (availableMonths.length === 0) return;

    const currentMonthKey = availableMonths[currentMonthIndex];
    const [yearStr, monthStr] = currentMonthKey.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    document.getElementById('current-month-display').innerText = `${monthNames[month]} ${year}`;
    document.getElementById('btn-prev').disabled = currentMonthIndex === 0;
    document.getElementById('btn-next').disabled = currentMonthIndex === availableMonths.length - 1;

    const filteredData = allData.filter(v => {
        const [aller] = v.id_date.split(' > ');
        const [d, m, y] = aller.split('.');

        const isCurrentMonth = `${y}-${m}` === currentMonthKey;
        const isPriceOk = v.prix <= maxPrice;
        const isDepartOk = selectedDepart === 'all' || v.depart === selectedDepart;
        const isAirlineOk = selectedAirline === 'all' || v.compagnie === selectedAirline;

        return isCurrentMonth && isPriceOk && isDepartOk && isAirlineOk;
    });

    const volsParDestination = {};
    filteredData.forEach(f => {
        if (!volsParDestination[f.destination]) {
            volsParDestination[f.destination] = [];
        }
        volsParDestination[f.destination].push(f);
    });

    const destinationsArray = Object.keys(volsParDestination).map(dest => {
        return {
            nom: dest,
            vols: volsParDestination[dest].sort((a, b) => a.prix - b.prix)
        };
    });

    destinationsArray.sort((a, b) => a.vols[0].prix - b.vols[0].prix);

    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    if (destinationsArray.length === 0) {
        grid.innerHTML = '<p class="text-center text-muted mt-4">Aucun vol trouvé avec ces critères pour ce mois.</p>';
        document.getElementById('status').innerText = '0 options trouvées';
        return;
    }

    destinationsArray.forEach((destination, index) => {
        const prixMinimum = destination.vols[0].prix.toFixed(2);
        const accordionId = `content-${index}`;

        const calendarHtml = generateCalendar(destination.vols, year, month);

        let volsHtml = destination.vols.map(f => {
            const [aller, retour] = f.id_date.split(' > ');
            return `
                <div class="list-item d-flex justify-between align-center py-3">
                    <div class="d-flex flex-column gap-1">
                        <div class="fw-bold text-dark">
                            Du ${aller} au ${retour}
                            <span class="badge ml-2">${f.compagnie}</span>
                        </div>
                        <div class="text-small text-muted">
                            Départ de <strong>${f.depart}</strong> • Aller à ${f.h_aller} • Retour à ${f.h_retour}
                        </div>
                    </div>
                    <div class="fw-bold text-success" style="font-size: 1.2em;">${f.prix.toFixed(2)} €</div>
                </div>
            `;
        }).join('');

        const destinationCard = `
            <div class="card mb-4 p-0">
                <div class="accordion-header d-flex justify-between align-center p-3 cursor-pointer" onclick="toggleAccordion('${accordionId}')">
                    <h2 class="text-primary m-0">${destination.nom}</h2>
                    <div class="d-flex align-center gap-2">
                        <div class="price-tag">À partir de ${prixMinimum} €</div>
                        <span class="text-muted">▼</span>
                    </div>
                </div>

                <div id="${accordionId}" class="d-none p-3 border-top">
                    <h3 class="text-muted text-small mb-3" style="text-transform: uppercase; letter-spacing: 1px;">Aperçu des dates</h3>
                    ${calendarHtml}

                    <h3 class="text-muted text-small mb-2 mt-4" style="text-transform: uppercase; letter-spacing: 1px;">Détails et horaires</h3>
                    ${volsHtml}
                </div>
            </div>
        `;

        grid.innerHTML += destinationCard;
    });

    document.getElementById('status').innerText = `${filteredData.length} options pour ${monthNames[month]}`;
}

async function loadFlights() {
    try {
        const response = await fetch(JSON_FILE);
        allData = await response.json();

        const monthSet = new Set();
        allData.forEach(v => {
            const [aller] = v.id_date.split(' > ');
            const [d, m, y] = aller.split('.');
            monthSet.add(`${y}-${m.padStart(2, '0')}`);
        });

        availableMonths = Array.from(monthSet).sort();
        currentMonthIndex = 0;

        initFilters(allData);

        updateView();
    } catch (e) {
        document.getElementById('status').innerText = "Erreur de chargement";
        console.error(e);
    }
}

loadFlights();