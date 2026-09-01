# SmartBasket UML Class Diagram

```mermaid
classDiagram
    class User {
        +Integer id (PK)
        +String username (UNIQUE)
        +String email (UNIQUE)
        +String password_hash
        +DateTime created_at
        +List~SavedBasket~ baskets
    }

    class Product {
        +String id (PK)
        +String name
        +String store
        +Float price
        +String formatted_price
        +String image_url
        +DateTime last_updated
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

    %% Relationships
    User "1" --> "*" SavedBasket : owns
    User "1" --> "0..1" UserPreference : has
    User "1" --> "0..1" ActiveCart : has
    SavedBasket "1" --> "*" BasketItem : contains
    Product "1" --> "*" BasketItem : referenced_in
```

## Class Details

### User
- Manages user accounts with authentication
- Has many saved baskets
- Can have preferences and an active cart

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
- One-to-one relationship with User

### SavedBasket
- Container for saved shopping baskets
- Can belong to a user (nullable for guest baskets)
- Contains multiple basket items

### BasketItem
- Individual item in a saved basket
- Links products to baskets
- Stores quantity, price, and competitor prices
