# Licenças e atribuições dos dados

O código do SampaNav é distribuído sob a licença MIT (veja [`LICENSE`](../LICENSE)).
Os dados usados pelo projeto **não** são cobertos por essa licença: cada fonte mantém
a sua própria licença e condições de uso.

| Fonte | Uso no projeto | Licença / condições | Atribuição |
|---|---|---|---|
| OpenStreetMap | Malha viária e grafo de rotas | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) |
| SSP-SP, "Dados criminais" | Ocorrências usadas no cálculo de risco | Dados públicos de transparência do Governo do Estado de SP | Fonte: SSP-SP, em <https://www.ssp.sp.gov.br/estatistica/consultas> |
| GeoSampa (Prefeitura de SP) | Pontos de iluminação pública | Dados públicos da Prefeitura de São Paulo (verificar termos de uso no GeoSampa) | Fonte: GeoSampa, Prefeitura de São Paulo |
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
