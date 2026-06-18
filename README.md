# radar-receita

real-time revenue estimation from a single speed camera in campinas, brazil.

scrapes live detection logs from an [exposed EGB Systems panel](http://191.246.88.18:5000/) — every vehicle that passes the sensor is logged with speed, size, profile, and lane. the scraper parses ~17k+ daily detections to estimate how much one intersection generates in fines.

## what it does

- scrapes the camera's Ritux detection log every 30 seconds
- parses each vehicle detection: speed, profile (car/motorcycle/truck/bus), lane, timestamp
- identifies speed violations using INMETRO tolerance rules (-7 km/h for speeds < 100)
- tracks red light enforcement cycles
- calculates estimated revenue using official CTB fine values
- serves a minimal dashboard with live feed

## the camera

| | |
|---|---|
| **location** | av. ruy rodriguez x terminal santa lucia, campinas-sp |
| **speed limit** | 50 km/h |
| **equipment** | MMV544 Engebras, serial 0363/2021 |
| **lanes** | 3 active (of 8 configured) |
| **operation** | 24/7 speed + red light + bus lane + prohibited turn |

## fine values (CTB)

| violation | severity | fine |
|---|---|---|
| speed up to 20% over | media | R$ 130.16 |
| speed 20-50% over | grave | R$ 195.23 |
| speed >50% over | gravissima x3 | R$ 880.41 |
| red light | gravissima | R$ 293.47 |

## run locally

```bash
npm install
npm start
# http://localhost:3000
```

## api

- `GET /api/stats` — full stats, breakdown, and live feed
- `GET /api/health` — scraper health, uptime, error count

## data

no personal data is collected or exposed. license plates appear in the raw camera logs but are discarded during parsing — the scraper only extracts aggregate vehicle data (speed, size, profile, lane).

## numbers (sample day)

- ~17,500 vehicles
- ~20 speed violations
- ~680 red light enforcement cycles
- estimated daily revenue: ~R$ 34,000
- projected annual revenue: **~R$ 12M** from a single camera
