import rmqrcode

def make_rmqr_svg(data_url, output_paths, module_size=6):
    qr = rmqrcode.rMQR.fit(data_url)
    grid = qr.to_list(with_quiet_zone=True)
    h = len(grid)
    w = len(grid[0])
    width = w * module_size
    height = h * module_size
    rects = []
    for y in range(h):
        for x in range(w):
            if grid[y][x]:
                rects.append(f'<rect x="{x*module_size}" y="{y*module_size}" width="{module_size}" height="{module_size}"/>')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" shape-rendering="crispEdges"><rect width="{width}" height="{height}" fill="#ffffff" rx="4"/><g fill="#0a0712">{"".join(rects)}</g></svg>'
    for p in output_paths:
        with open(p, 'w', encoding='utf-8') as f:
            f.write(svg)
    print(f"Generated rMQR ({qr.version_name()}, {width}x{height}) -> {output_paths}")

if __name__ == '__main__':
    make_rmqr_svg(
        'https://hermotorsport.com/?driver=42',
        ['assets/img/rmqr-sample.svg', 'cloudflare-worker/public/assets/img/rmqr-sample.svg']
    )
    # Also generate a PNG version using QRImage for testing
    qr = rmqrcode.rMQR.fit('https://hermotorsport.com/?driver=42')
    img = rmqrcode.QRImage(qr, module_size=6)
    img.save('assets/img/rmqr-sample.png')
    img.save('cloudflare-worker/public/assets/img/rmqr-sample.png')
    print("Generated PNGs as well!")
