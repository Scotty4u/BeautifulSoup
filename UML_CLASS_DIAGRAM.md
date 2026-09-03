# SmartBasket UML Class Diagram (Draft)

```mermaid
classDiagram
    class User {
        +Integer id (PK)
        +String username (UNIQUE)
        +String email (UNIQUE)
        +String password_hash
        +DateTime created_at
        +List~SavedBasket~ baskets
        +List~Review~ reviews
    }

    class Store {
        +Integer id (PK)
        +String name (UNIQUE)
        +String store_key
        +String logo_url
        +String website_url
        +DateTime created_at
        +List~Product~ products
    }

    class Category {
        +Integer id (PK)
        +String name
        +String description
        +String icon_url
        +List~Product~ products
    }

    class Product {
        +String id (PK)
        +String name
        +Integer store_id (FK)
        +Integer category_id (FK)
        +Float price
        +String formatted_price
        +String image_url
        +DateTime last_updated
        +List~BasketItem~ basket_items
        +List~PriceHistory~ price_history
        +List~Review~ reviews
    }

    class PriceHistory {
        +Integer id (PK)
        +String product_id (FK)
        +Float price
        +DateTime recorded_at
        +String store_name
    }

    class UserPreference {
        +Integer id (PK)
        +Integer user_id (FK)
        +String preferred_store
        +DateTime created_at
    }

    class ActiveCart {
        +Integer user_id (PK, FK)
        +String items_json
        +DateTime updated_at
    }

    class SavedBasket {
        +Integer id (PK)
        +Integer user_id (FK)
        +String name
        +DateTime created_at
        +List~BasketItem~ items
    }

    class BasketItem {
        +Integer id (PK)
        +Integer basket_id (FK)
        +String product_id (FK)
        +Integer quantity
        +Float price
        +String competitor_prices
        +Product product
    }

    class Review {
        +Integer id (PK)
        +Integer user_id (FK)
        +String product_id (FK)
        +Integer rating
        +String comment
        +DateTime created_at
        +Integer helpful_count
    }

    %% Relationships
    User "1" --> "*" SavedBasket : owns
    User "1" --> "0..1" UserPreference : has
    User "1" --> "0..1" ActiveCart : has
    User "1" --> "*" Review : writes
    
    Store "1" --> "*" Product : makes_available
    Category "1" --> "*" Product : categorizes
    Product "1" --> "*" BasketItem : in
    Product "1" --> "*" PriceHistory : has
    Product "1" --> "*" Review : reviewed_in
    
    SavedBasket "1" --> "*" BasketItem : contains
```

## Core Tables (Original 6)

### User
- Manages user accounts with authentication
- Has many saved baskets and reviews

### Product
- Represents products from different stores
- Tracks price and product information
- Referenced by basket items for price comparison

### UserPreference
- Stores user's preferred store
- One-to-one relationship with User

### ActiveCart
- Tracks the user's current shopping session
- Stores items as JSON

### SavedBasket
- Container for saved shopping baskets
- Contains multiple basket items

### BasketItem
- Individual item in a saved basket
- Links products to baskets

## Additional Tables

### Store
- Manages different supermarket chains (Pick n Pay, Shoprite, Checkers, Woolworths)
- One-to-many relationship with Product
- Tracks store metadata like logos and websites so shoppers know where to find products

### Category
- Organizes products by type (Groceries, Electronics, Clothing, etc.)
- One-to-many relationship with Product
- Improves product discovery and navigation

### PriceHistory
- **Critical for price comparison feature**
- Tracks historical price changes per product per store
- Enables price trend analysis and alerts
- One-to-many relationship with Product

### Review
- User reviews and ratings for products
- Allows users to rate products and leave comments
- Tracks helpful votes on reviews
- Links User, Product together

### In-store shopping
- SmartBasket does not process purchases, orders, or deliveries.
- Products and prices show shoppers which retailer has an item available.
- Users visit the listed store to purchase the items themselves.
- Baskets are shopping lists used for store and price comparison.
