import asyncio
from playwright.async_api import async_playwright

async def download_html(url, output_file="picknpay.html"):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded")
        
        # Wait for actual product cards to appear
        try:
            await page.wait_for_selector(".product-grid-item", timeout=30_000)
            print("Products loaded ✓")
        except:
            print("⚠️ Products didn't appear")
        
        html = await page.content()
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(html)
        
        print(f"Saved to {output_file}")
        await browser.close()

asyncio.run(download_html("https://www.pnp.co.za/c/pnpbase?currentPage=1"))