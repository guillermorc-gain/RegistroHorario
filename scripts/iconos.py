#!/usr/bin/env python3
"""Los iconos de las aplicaciones, todos del mismo dibujo.

Es el mismo reloj para las cinco; lo único que cambia es el color de fondo y
la insignia de abajo a la derecha. Se hacen aquí y se guardan en el
repositorio para que el móvil y el navegador instalen exactamente el mismo
fichero: cuando cada uno se dibujaba por su lado nunca acababan de cuadrar.

    python3 scripts/iconos.py            # las que faltan
    python3 scripts/iconos.py --todas    # rehace también las que ya están
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELOJ = os.path.join(RAIZ, 'gestion', 'icons', 'reloj.png')
EMOJIS = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'
# Noto Color Emoji solo trae un tamaño de mapa de bits: hay que pedir ese y
# luego reescalar. Con cualquier otro, Pillow no la carga.
TALLA_EMOJI = 109

# fondo, color de la insignia, emoji, y dónde va cada tamaño
APPS = {
    'trabajador':  dict(bg=(21, 101, 192),  chapa=(255, 255, 255), emoji='\U0001F4AA',
                        destino='icons',         nombre='icon'),
    'gestion':     dict(bg=(108, 52, 131),  chapa=(255, 255, 255), emoji='✏️',
                        destino='gestion/icons', nombre='icon'),
    'desarrollador': dict(bg=(44, 62, 80),  chapa=(232, 89, 12),   emoji='⚙️',
                        destino='gestion/icons', nombre='icon-dev'),
    'control':     dict(bg=(24, 106, 59),   chapa=(255, 255, 255), emoji='\U0001F6E1️',
                        destino='control/icons', nombre='icon'),
    'gcontrol':    dict(bg=(123, 36, 28),   chapa=(255, 255, 255), emoji='\U0001F5DD️',
                        destino='control/icons', nombre='icon-gc'),
}


def dibujar(cfg, lado, con_fondo=True):
    """El icono a un tamaño. Sin fondo es el de la capa de delante, el que
    Android recorta con la forma que tenga cada lanzador."""
    if con_fondo:
        im = Image.new('RGBA', (lado, lado), cfg['bg'] + (255,))
    else:
        im = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))

    # El reloj, a todo lo ancho. En la capa de delante va más pequeño: el
    # lanzador se come los bordes al recortarla.
    escala = 1.0 if con_fondo else 2 / 3
    lado_reloj = int(lado * escala)
    reloj = Image.open(RELOJ).convert('RGBA').resize((lado_reloj, lado_reloj), Image.LANCZOS)
    hueco = (lado - lado_reloj) // 2
    im.alpha_composite(reloj, (hueco, hueco))

    # La insignia: abajo a la derecha del reloj, no de la imagen
    centro = hueco + lado_reloj * 0.76
    radio = lado_reloj * 0.112
    d = ImageDraw.Draw(im)
    d.ellipse([centro - radio, centro - radio, centro + radio, centro + radio],
              fill=cfg['chapa'] + (255,), outline=(255, 255, 255, 255),
              width=max(1, int(lado_reloj * 0.012)))

    # El emoji dentro, en color
    cara = int(radio * 1.45)
    fuente = ImageFont.truetype(EMOJIS, TALLA_EMOJI)
    sello = Image.new('RGBA', (TALLA_EMOJI * 2, TALLA_EMOJI * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sello).text((TALLA_EMOJI // 2, TALLA_EMOJI // 2), cfg['emoji'],
                               font=fuente, embedded_color=True, anchor='mm')
    caja = sello.getbbox()
    if caja:
        sello = sello.crop(caja)
        ancho = max(1, int(cara * sello.width / max(sello.width, sello.height)))
        alto = max(1, int(cara * sello.height / max(sello.width, sello.height)))
        sello = sello.resize((ancho, alto), Image.LANCZOS)
        im.alpha_composite(sello, (int(centro - ancho / 2), int(centro - alto / 2)))
    return im


def main():
    todas = '--todas' in sys.argv
    hechos = 0
    for nombre, cfg in APPS.items():
        carpeta = os.path.join(RAIZ, cfg['destino'])
        os.makedirs(carpeta, exist_ok=True)
        piezas = [(f"{cfg['nombre']}-192.png", 192, True),
                  (f"{cfg['nombre']}-512.png", 512, True),
                  (f"{cfg['nombre']}-fg-512.png", 512, False)]
        for fichero, lado, fondo in piezas:
            ruta = os.path.join(carpeta, fichero)
            if os.path.exists(ruta) and not todas:
                continue
            im = dibujar(cfg, lado, fondo)
            im.convert('RGB' if fondo else 'RGBA').save(ruta)
            print('✅', os.path.relpath(ruta, RAIZ))
            hechos += 1
    if not hechos:
        print('Ya estaban todos. Con --todas se rehacen.')


if __name__ == '__main__':
    main()
