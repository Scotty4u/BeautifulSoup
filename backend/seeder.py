import asyncio
import time
import random
from datetime import datetime, timedelta

def seed_initial_data():
    from app import app, db, Product, Store, Category, PriceHistory, internal_fetch_competitors
    
    print("🌱 [Auto-Seeder] Populating Front Page & Categories in the background...")
    
    # Map staples to their respective database category names
    staples_with_categories = [
        ("milk", "Dairy & Fresh Milk"),
        ("butter", "Dairy & Fresh Milk"),
        ("cheese", "Dairy & Fresh Milk"),
        ("bread", "Bakery & Breads"),
        ("eggs", "Dairy & Fresh Milk"),
        ("chicken", "Meat & Poultry"),
        ("rice", "Pantry Staples"),
        ("sugar", "Pantry Staples"),
        ("cooking oil", "Pantry Staples"),
        ("juice", "Fruits & Juices"),
        ("coca cola", "Snacks & Treats")
    ]
    
    with app.app_context():
        for query, cat_name in staples_with_categories:
            print(f"🛒 [Auto-Seeder] Fetching items for: {query} -> [{cat_name}]...")
            
            # Find the category ID from the database
            category_record = Category.query.filter_by(name=cat_name).first()
            category_id = category_record.id if category_record else None
            
            results = asyncio.run(internal_fetch_competitors(query))
            
            if not results:
                print(f"   ⚠️ No results found for '{query}'.")
                continue

            for item in results:
                prod_id = str(item.get('id', ''))
                if not prod_id: 
                    continue
                
                store_name = item.get('store', 'Unknown')
                store_record = Store.query.filter_by(name=store_name).first()
                store_id = store_record.id if store_record else None
                price_val = float(item.get('price', 0.0))

                existing = db.session.get(Product, prod_id)

                if not existing:
                    new_p = Product(
                        id=prod_id, 
                        name=item.get('name', 'Unknown Product'),
                        store=store_name, 
                        store_id=store_id,
                        category_id=category_id,
                        price=price_val,
                        formatted_price=item.get('formattedPrice', f"R {price_val:.2f}"),
                        image_url=item.get('imageUrl', '')
                    )
                    # merge() prevents unique constraint crashes on shared IDs
                    db.session.merge(new_p)

                    # Generate 14 days of synthetic price history for charts
                    for days_ago in range(14, 0, -1):
                        past_date = datetime.utcnow() - timedelta(days=days_ago)
                        simulated_price = price_val * random.uniform(0.95, 1.05)
                        db.session.add(PriceHistory(
                            product_id=prod_id, 
                            price=round(simulated_price, 2),
                            recorded_at=past_date, 
                            store_name=store_name
                        ))
                else:
                    existing.price = price_val
                    existing.category_id = category_id
                    existing.last_updated = datetime.utcnow()

                # Always log today's actual price point
                db.session.add(PriceHistory(
                    product_id=prod_id, 
                    price=price_val, 
                    store_name=store_name
                ))

            db.session.commit()
            print(f"   ✅ Saved items for '{query}'.")
            time.sleep(3)
            
    print("\n🎉 [Auto-Seeder] Database is fully populated with categories and history!")

if __name__ == "__main__":
    seed_initial_data()