# Licenças e atribuições dos dados

O código do SampaNav é distribuído sob a licença MIT (veja [`LICENSE`](../LICENSE)).
Os dados usados pelo projeto **não** são cobertos por essa licença: cada fonte mantém
a sua própria licença e condições de uso.

| Fonte | Uso no projeto | Licença / condições | Atribuição |
|---|---|---|---|
| OpenStreetMap | Malha viária e grafo de rotas | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) |
| SSP-SP, "Dados criminais" | Ocorrências usadas no cálculo de risco | Dados públicos de transparência do Governo do Estado de SP | Fonte: SSP-SP, em <https://www.ssp.sp.gov.br/estatistica/consultas> |
| GeoSampa (Prefeitura de SP) | Pontos de iluminação pública (ajuste noturno do risco) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Fonte: GeoSampa, Prefeitura de São Paulo (<https://geosampa.prefeitura.sp.gov.br>) |
| Photon (komoot) | Geocodificação de endereços | Baseado em dados do OpenStreetMap (ODbL) | Photon © komoot; dados © OpenStreetMap contributors |
| OpenFreeMap | Tiles e estilo do mapa | Dados do OpenStreetMap (ODbL), esquema OpenMapTiles | © OpenStreetMap contributors; [OpenFreeMap](https://openfreemap.org) |

## Observações

- Pela ODbL, qualquer uso público dos mapas ou das rotas derivadas do OpenStreetMap
  deve manter a atribuição "© OpenStreetMap contributors" com link para
  <https://www.openstreetmap.org/copyright>. O controle de atribuição do mapa fica ativo em
  `frontend/js/map.js`; mantenha-o visível em qualquer alteração da interface.
- Os dados da SSP-SP são usados como estatística agregada para estimar exposição a risco.
  Eles não identificam pessoas e não representam a totalidade de ocorrências.
- Ao redistribuir os dados processados (`data/`), mantenha as atribuições acima e a licença
  de cada fonte.
- **GeoSampa é CC BY-SA 4.0 (compartilhar pela mesma licença).** O pacote
  `sampanav-inputs.tar.gz` das Releases redistribui os pontos de iluminação, e o risco em
  `sampanav-data.tar.gz` é derivado deles nos períodos noturnos. Por isso esses pacotes
  são publicados com atribuição ao GeoSampa e a parte derivada da iluminação fica sob
  CC BY-SA 4.0. As notas de cada Release dizem isso (veja `.github/workflows/data-refresh.yml`).
  Os elementos derivados do OpenStreetMap nos mesmos pacotes seguem a ODbL.
