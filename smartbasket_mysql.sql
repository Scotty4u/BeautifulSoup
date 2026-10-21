-- SmartBasket schema for MySQL import in dbdiagram.io.
-- Diagram conversion; the application still uses SQLite.
-- The SQLite partial index is documented below instead of converted.

CREATE TABLE users (
	id INT NOT NULL, 
	username VARCHAR(80) NOT NULL, 
	email VARCHAR(120) NOT NULL, 
	password_hash VARCHAR(256) NOT NULL, 
	is_admin BOOLEAN NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	location VARCHAR(100), 
	latitude FLOAT, 
	longitude FLOAT, 
	nearby_radius_km INT NOT NULL, 
	date_of_birth DATE, 
	age_confirmation BOOLEAN, 
	postal_code VARCHAR(12), 
	notifications_opt_in BOOLEAN NOT NULL, 
	marketing_opt_in BOOLEAN NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (username), 
	UNIQUE (email)
);

CREATE TABLE system_logs (
	id INT NOT NULL, 
	action VARCHAR(255) NOT NULL, 
	details TEXT, 
	created_at DATETIME, 
	PRIMARY KEY (id)
);

CREATE TABLE stores (
	id INT NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	store_key VARCHAR(50), 
	logo_url VARCHAR(255), 
	website_url VARCHAR(255), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (name)
);

CREATE TABLE categories (
	id INT NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	description TEXT, 
	icon_url VARCHAR(255), 
	PRIMARY KEY (id), 
	UNIQUE (name)
);

CREATE TABLE products (
	id VARCHAR(100) NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	price FLOAT NOT NULL, 
	formatted_price VARCHAR(20), 
	image_url TEXT, 
	product_url TEXT, 
	barcode VARCHAR(14), 
	age_restricted BOOLEAN NOT NULL, 
	catalog_category VARCHAR(48) NOT NULL, 
	last_updated DATETIME, 
	store_id INT, 
	category_id INT, 
	store VARCHAR(50), 
	PRIMARY KEY (id), 
	FOREIGN KEY(store_id) REFERENCES stores (id), 
	FOREIGN KEY(category_id) REFERENCES categories (id)
);

CREATE TABLE search_history (
	id INT NOT NULL, 
	user_id INT, 
	`query` VARCHAR(255) NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE search_action_receipts (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	action_id VARCHAR(80) NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_user_search_action UNIQUE (user_id, action_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE user_preferences (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	preferred_store VARCHAR(50) NOT NULL, 
	monthly_budget FLOAT, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE active_carts (
	user_id INT NOT NULL, 
	items_json TEXT NOT NULL, 
	updated_at DATETIME, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE saved_baskets (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	name_key TEXT, 
	created_at DATETIME, 
	share_token VARCHAR(64), 
	is_public BOOLEAN NOT NULL, 
	is_collaborative BOOLEAN, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	UNIQUE (share_token)
);

CREATE TABLE store_deals (
	id INT NOT NULL, 
	product_id VARCHAR(100) NOT NULL, 
	original_price FLOAT NOT NULL, 
	sale_price FLOAT NOT NULL, 
	valid_until DATETIME, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE price_history (
	id INT NOT NULL, 
	product_id VARCHAR(100) NOT NULL, 
	price FLOAT NOT NULL, 
	recorded_at DATETIME, 
	store_name VARCHAR(100), 
	PRIMARY KEY (id), 
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE basket_items (
	id INT NOT NULL, 
	basket_id INT NOT NULL, 
	product_id VARCHAR(100) NOT NULL, 
	quantity INT, 
	price FLOAT, 
	competitor_prices TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(basket_id) REFERENCES saved_baskets (id), 
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE basket_activities (
	id INT NOT NULL, 
	basket_id INT NOT NULL, 
	user_id INT NOT NULL, 
	action VARCHAR(255) NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(basket_id) REFERENCES saved_baskets (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE reviews (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	product_id VARCHAR(100) NOT NULL, 
	rating INT NOT NULL, 
	comment TEXT NOT NULL, 
	helpful_count INT, 
	created_at DATETIME, 
	author_name VARCHAR(100), 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE saved_basket_collaborators (
	id INT NOT NULL, 
	saved_basket_id INT NOT NULL, 
	user_id INT NOT NULL, 
	status VARCHAR(20), 
	role VARCHAR(20), 
	PRIMARY KEY (id), 
	FOREIGN KEY(saved_basket_id) REFERENCES saved_baskets (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE notifications (
	id INT NOT NULL, 
	recipient_id INT NOT NULL, 
	sender_id INT NOT NULL, 
	basket_id INT NOT NULL, 
	message VARCHAR(255) NOT NULL, 
	status VARCHAR(20), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(recipient_id) REFERENCES users (id), 
	FOREIGN KEY(sender_id) REFERENCES users (id), 
	FOREIGN KEY(basket_id) REFERENCES saved_baskets (id)
);

CREATE TABLE shopping_alert_preferences (
	user_id INT NOT NULL, 
	options JSON NOT NULL, 
	checked_at DATETIME, 
	reminder_at DATETIME, 
	PRIMARY KEY (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE shopping_alerts (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	kind VARCHAR(30) NOT NULL, 
	group_key VARCHAR(160) NOT NULL, 
	dedupe_key VARCHAR(220) NOT NULL, 
	message VARCHAR(500) NOT NULL, 
	url VARCHAR(220) NOT NULL, 
	unread BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_shopping_alert_dedupe UNIQUE (user_id, dedupe_key), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE delivery_addresses (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	label VARCHAR(60) NOT NULL, 
	recipient VARCHAR(100) NOT NULL, 
	phone VARCHAR(25) NOT NULL, 
	street VARCHAR(180) NOT NULL, 
	suburb VARCHAR(100) NOT NULL, 
	city VARCHAR(100) NOT NULL, 
	province VARCHAR(80) NOT NULL, 
	postal_code VARCHAR(12) NOT NULL, 
	notes VARCHAR(250) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE shopping_orders (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	address_id INT NOT NULL, 
	request_id VARCHAR(80) NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	retailer VARCHAR(50), 
	fulfillment_type VARCHAR(16) NOT NULL, 
	pickup_branch VARCHAR(120) NOT NULL, 
	total NUMERIC(12, 2) NOT NULL, 
	estimated_savings NUMERIC(12, 2), 
	baseline_total NUMERIC(12, 2), 
	baseline_retailer VARCHAR(50), 
	address_snapshot JSON NOT NULL, 
	placed_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_order_request_user UNIQUE (user_id, request_id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(address_id) REFERENCES delivery_addresses (id)
);

CREATE TABLE shopping_order_lines (
	id INT NOT NULL, 
	order_id INT NOT NULL, 
	product_id VARCHAR(100) NOT NULL, 
	product_name VARCHAR(255) NOT NULL, 
	retailer VARCHAR(50) NOT NULL, 
	image_url TEXT, 
	quantity INT NOT NULL, 
	unit_price NUMERIC(12, 2) NOT NULL, 
	line_total NUMERIC(12, 2) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES shopping_orders (id)
);

CREATE TABLE shopping_order_events (
	id INT NOT NULL, 
	order_id INT NOT NULL, 
	status VARCHAR(32) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES shopping_orders (id)
);

CREATE TABLE sb_auth_sessions (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	device_hash VARCHAR(64) NOT NULL, 
	user_agent VARCHAR(220) NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	expires_at DATETIME NOT NULL, 
	revoked_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (token_hash)
);

CREATE TABLE sb_login_throttles (
	`key` VARCHAR(64) NOT NULL, 
	failures INT NOT NULL, 
	window_started DATETIME NOT NULL, 
	PRIMARY KEY (`key`)
);

CREATE TABLE sb_price_watches (
	id INT NOT NULL, 
	user_id INT NOT NULL, 
	product_id VARCHAR(100) NOT NULL, 
	target_price FLOAT, 
	last_notified_price FLOAT, 
	active BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_sb_user_product_watch UNIQUE (user_id, product_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE sb_scraper_health (
	store VARCHAR(40) NOT NULL, 
	last_attempt_at DATETIME, 
	last_nonempty_at DATETIME, 
	last_error_at DATETIME, 
	last_error_type VARCHAR(90), 
	last_result_count INT, 
	consecutive_errors INT, 
	consecutive_empty INT, 
	total_calls INT, 
	total_errors INT, 
	total_empty INT, 
	PRIMARY KEY (store)
);

CREATE INDEX ix_products_catalog_category ON products (catalog_category);

CREATE INDEX ix_products_last_updated ON products (last_updated);

CREATE INDEX ix_products_store ON products (store);

CREATE INDEX ix_products_name ON products (name);

CREATE INDEX ix_search_action_receipts_user_id ON search_action_receipts (user_id);

CREATE INDEX ix_reviews_product_id ON reviews (product_id);

-- SQLite partial unique index omitted: name_key is TEXT and MySQL requires a key length.
-- Original: UNIQUE (user_id, name_key) WHERE name_key IS NOT NULL.

CREATE INDEX ix_shopping_alerts_user_id ON shopping_alerts (user_id);

CREATE INDEX ix_delivery_addresses_user_id ON delivery_addresses (user_id);

CREATE INDEX ix_shopping_orders_placed_at ON shopping_orders (placed_at);

CREATE INDEX ix_shopping_orders_user_id ON shopping_orders (user_id);

CREATE INDEX ix_shopping_order_lines_order_id ON shopping_order_lines (order_id);

CREATE INDEX ix_shopping_order_events_order_id ON shopping_order_events (order_id);

CREATE INDEX ix_sb_auth_sessions_user_id ON sb_auth_sessions (user_id);

CREATE INDEX ix_sb_price_watches_user_id ON sb_price_watches (user_id);
