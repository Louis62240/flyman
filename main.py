import requests
import calendar
import time
import json
import logging
import random
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup
from typing import List, Dict, Optional

CONFIG = {
    "sources": [
        "Brussels [CRL]",
        "Paris [CDG]"
    ],
    "dst": "Anywhere [XXX]",
    "mois": [6, 7, 8, 9, 10, 11, 12],
    "annee": 2026,
    "filters": {
        "h_aller_min": "0:00",
        "h_aller_max": "12:00",
        "h_retour_min": "18:00",
        "h_retour_max": "24:00",
        "max_escales": 0
    },
    "max_workers": 5,
    "output_file": "vols_ete_2026.json"
}

USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
]

logging.basicConfig(level=logging.INFO, format='%(message)s')

class AzairScraper:
    def __init__(self, config: Dict):
        self.config = config
        self.session = requests.Session()
        self.file_lock = threading.Lock() # Sécurité pour écrire dans le fichier avec plusieurs threads

    def _generate_weekend_dates(self) -> List[tuple]:
        dates = []
        year = self.config['annee']
        mois_liste = self.config['mois'] if isinstance(self.config['mois'], list) else [self.config['mois']]

        cal = calendar.Calendar(firstweekday=calendar.MONDAY)

        for month in mois_liste:
            for week in cal.monthdayscalendar(year, month):
                # Vendredi à Dimanche
                if week[4] != 0 and week[4] + 2 <= calendar.monthrange(year, month)[1]:
                    dates.append((f"{week[4]:02d}.{month:02d}.{year}", f"{week[4]+2:02d}.{month:02d}.{year}", f"Ven-Dim (Mois {month})"))
                # Samedi à Lundi
                if week[5] != 0 and week[5] + 2 <= calendar.monthrange(year, month)[1]:
                    dates.append((f"{week[5]:02d}.{month:02d}.{year}", f"{week[5]+2:02d}.{month:02d}.{year}", f"Sam-Lun (Mois {month})"))
        return dates

    def _build_params(self, src: str, dep: str, arr: str) -> dict:
        f = self.config["filters"]
        return {
            "tp": 0, "searchtype": "nonflexi", "adults": 1, "currency": "EUR",
            "isOneway": "return", "srcAirport": src, "dstAirport": self.config['dst'],
            "depdate": dep, "arrdate": arr, "maxChng": f["max_escales"],
            "minHourOutbound": f["h_aller_min"], "maxHourOutbound": f["h_aller_max"],
            "minHourInbound": f["h_retour_min"], "maxHourInbound": f["h_retour_max"],
            "resultSubmit": "Search"
        }

    def _get_html(self, src: str, dep: str, arr: str, max_retries: int = 3) -> Optional[str]:
        params = self._build_params(src, dep, arr)

        for attempt in range(max_retries):
            # Changer de User-Agent à chaque requête pour éviter le blocage
            self.session.headers.update({'User-Agent': random.choice(USER_AGENTS)})

            try:
                r = self.session.get("https://www.azair.eu/azfin.php", params=params, timeout=15)
                r.raise_for_status()
                return r.text
            except Exception as e:
                logging.warning(f"⚠️ Échec {attempt + 1}/{max_retries} pour {src} ({dep}) : {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 * (attempt + 1)) # Backoff exponentiel: 2s, 4s...
                else:
                    logging.error(f"❌ Abandon de la date {dep} depuis {src}")
                    return None

    def _parse(self, html: str, date_label: str, src_label: str, dep_date: str, arr_date: str) -> List[Dict]:
        if not html: return []
        soup = BeautifulSoup(html, 'html.parser')
        extracted = []

        # Génération du lien de réservation direct
        params = self._build_params(src_label, dep_date, arr_date)
        direct_url = "https://www.azair.eu/azfin.php?" + urllib.parse.urlencode(params)

        for row in soup.select('div.result'):
            try:
                p_tag = row.select_one('.totalPrice .tp')
                d_tag = row.select('span.to')
                t_tags = row.select('span.from strong')

                if p_tag and len(d_tag) >= 2:
                    raw_dest = d_tag[0].get_text(separator=' ', strip=True)[5:].strip()
                    prix = float(p_tag.get_text(strip=True).replace('€', '').replace(',', '.').strip())

                    extracted.append({
                        "depart": src_label.split(' [')[0], # Garde juste le nom de la ville (ex: "Paris")
                        "id_date": date_label,
                        "destination": raw_dest[:-3].strip() if len(raw_dest) > 3 else raw_dest,
                        "h_aller": t_tags[0].text.strip(),
                        "h_retour": t_tags[1].text.strip(),
                        "prix": prix,
                        "compagnie": row.select_one('span.airline').text.strip() if row.select_one('span.airline') else "N/A",
                        "url_reservation": direct_url
                    })
            except Exception as e:
                continue
        return extracted

    def _save_to_json(self, data: List[Dict]):
        # Sauvegarde thread-safe
        with self.file_lock:
            with open(self.config["output_file"], 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)

    def _process_weekend(self, src: str, d_dep: str, d_arr: str, label: str) -> List[Dict]:
        logging.info(f"🔎 Recherche : {src} | {d_dep} > {d_arr}...")

        # Petit délai aléatoire pour ne pas bombarder le serveur d'un coup
        time.sleep(random.uniform(0.5, 2.0))

        html = self._get_html(src, d_dep, d_arr)
        return self._parse(html, f"{d_dep} > {d_arr}", src, d_dep, d_arr)

    def run(self):
        all_results = []
        dates = self._generate_weekend_dates()
        total_tasks = len(self.config['sources']) * len(dates)

        logging.info(f"🚀 Démarrage du scraping. {total_tasks} week-ends à analyser avec {self.config['max_workers']} threads.\n")

        # Utilisation de ThreadPoolExecutor pour paralléliser
        with ThreadPoolExecutor(max_workers=self.config['max_workers']) as executor:
            futures = []
            for src in self.config['sources']:
                for d_dep, d_arr, label in dates:
                    futures.append(executor.submit(self._process_weekend, src, d_dep, d_arr, label))

            completed = 0
            for future in as_completed(futures):
                completed += 1
                result = future.result()
                if result:
                    all_results.extend(result)

                    # Trier et sauvegarder à chaque fois qu'on trouve de nouveaux vols (Incrémental)
                    all_results.sort(key=lambda x: x['prix'])
                    self._save_to_json(all_results)

                print(f"✅ Progression : {completed}/{total_tasks} requêtes terminées ({len(all_results)} vols trouvés)", end="\r")

        print("\n\n🎉 Scraping terminé ! Affichage du Top 15 des vols les moins chers :")
        if all_results:
            header = f"{'DEPART':<15} | {'DATE':<25} | {'DESTINATION':<20} | {'PRIX':<8} | {'COMPAGNIE'}"
            print("\n" + header + "\n" + "-"*len(header))
            for v in all_results[:15]:
                print(f"{v['depart'][:15]:<15} | {v['id_date']:<25} | {v['destination'][:20]:<20} | {v['prix']:>6.2f} € | {v['compagnie']}")

        return all_results

if __name__ == "__main__":
    scraper = AzairScraper(CONFIG)
    vols = scraper.run()