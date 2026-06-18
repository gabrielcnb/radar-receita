# radar-receita

scraper que puxa logs em tempo real de uma câmera de velocidade aberta em campinas e estima quanta receita ela gera em multas.

painel da câmera: http://191.246.88.18:5000/

## como funciona

a câmera (EGB Systems / Engebras MMV544) expõe um painel web com logs do sistema Ritux. cada veículo que passa é registrado com velocidade, perfil, faixa e tamanho. o scraper parseia esses logs, aplica as regras de tolerância do INMETRO e calcula a receita estimada com os valores oficiais do CTB.

av. ruy rodriguez x terminal santa lucia, campinas-sp. limite 50 km/h, 3 faixas ativas.

## multas

| infração | valor |
|---|---|
| velocidade até 20% acima | R$ 130,16 |
| velocidade 20-50% acima | R$ 195,23 |
| velocidade >50% acima | R$ 880,41 |
| avanço sinal vermelho | R$ 293,47 |

## rodar local

```
npm install
npm start
```

## api

- `GET /api/stats` — dados completos + feed
- `GET /api/health` — status da câmera

## números típicos (1 dia)

~17k veículos, ~20 multas de velocidade, ~680 ciclos de sinal vermelho, ~R$ 34k receita estimada.
