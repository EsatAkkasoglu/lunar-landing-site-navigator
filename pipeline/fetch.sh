#!/bin/sh
# SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
# Download raw NASA inputs into data_raw/ (not committed). SPICE kernels are fetched by build_ephem.py (Skyfield).
set -e
mkdir -p data_raw/sitehdr && cd data_raw
PDS=https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img
ILL=https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG
curl -sSfO $PDS/ldem_75s_240m_float.img
curl -sSfO $PDS/ldem_75s_240m_float.lbl
for f in AVGVISIB_65S_240M_201608 AVGVISIB_65S_240M_201608_EARTH; do curl -sSfO $ILL/$f.IMG; curl -sSfO $ILL/$f.LBL; done
# first 64 KB of each PGDA site GeoTIFF is enough for its georeferencing
for s in Site01 Site04 Site06 Site07 Site11 Site20 Site23 Site42 Haworth DM1 DM2; do
  curl -sSf -r 0-65535 -o sitehdr/$s.tif "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/$s/${s}_final_adj_5mpp_surf.tif"
done
