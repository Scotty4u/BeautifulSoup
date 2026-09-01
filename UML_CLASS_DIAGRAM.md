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
        +List~Order~ orders
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

    class Address {
        +Integer id (PK)
        +Integer user_id (FK)
        +String street_address
        +String city
        +String postal_code
        +String country
        +String phone_number
        +Boolean is_default
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

    class Order {
        +Integer id (PK)
        +Integer user_id (FK)
        +Integer address_id (FK)
        +Float total_price
        +String status
        +DateTime order_date
        +DateTime delivery_date
        +List~OrderItem~ items
        +List~Notification~ notifications
    }

    class OrderItem {
        +Integer id (PK)
        +Integer order_id (FK)
        +String product_id (FK)
        +Integer quantity
        +Float price_at_purchase
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

    class Notification {
        +Integer id (PK)
        +Integer user_id (FK)
        +Integer order_id (FK)
        +String type
        +String message
        +DateTime created_at
        +Boolean is_read
    }

    %% Relationships
    User "1" --> "*" SavedBasket : owns
    User "1" --> "0..1" UserPreference : has
    User "1" --> "0..1" ActiveCart : has
    User "1" --> "*" Address : has
    User "1" --> "*" Order : places
    User "1" --> "*" Review : writes
    User "1" --> "*" Notification : receives
    
    Store "1" --> "*" Product : sells
    Category "1" --> "*" Product : categorizes
    Product "1" --> "*" BasketItem : in
    Product "1" --> "*" PriceHistory : has
    Product "1" --> "*" Review : reviewed_in
    Product "1" --> "*" OrderItem : in
    
    SavedBasket "1" --> "*" BasketItem : contains
    Order "1" --> "*" OrderItem : contains
    Order "1" --> "1" Address : ships_to
    Order "1" --> "*" Notification : generates
```

## Core Tables (Original 6)

### User
- Manages user accounts with authentication
- Has many saved baskets, orders, and reviews

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

## New Tables (8 Additional)

### Store
- Manages different supermarket chains (Pick n Pay, Shoprite, Checkers, Woolworths)
- One-to-many relationship with Product
- Tracks store metadata like logos and websites

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

### Order
- Represents completed purchases
- Tracks order status and delivery dates
- Links to delivery address and generates notifications
- One-to-many relationship with OrderItem and Notification

### OrderItem
- Individual items within a completed order
- Stores price at time of purchase (for historical tracking)
- Similar to BasketItem but for finalized orders

### Notification
- Sends alerts to users (price drops, order status, etc.)
- Links User and Order
- Tracks read status for user engagement

### Address
- Stores multiple delivery addresses per user
- Supports default address selection
- One-to-many relationship with User
- Referenced by Order for shipping
