import asyncio
import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime
from typing import Dict, List, Tuple

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
import httpx
from fake_useragent import UserAgent
from apscheduler.schedulers.background import BackgroundScheduler

app = Flask(__name__)
CORS(app)

# ==========================================
# DATABASE CONFIGURATION (Flask-SQLAlchemy)
# ==========================================
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///smartbasket.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# ==========================================
# DATABASE MODELS
# ==========================================
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationship with Saved Baskets
    baskets = db.relationship('SavedBasket', backref='owner', lazy=True, cascade="all, delete-orphan")

class Product(db.Model):
    __tablename__ = 'products'
    id = db.Column(db.String(100), primary_key=True) # e.g. pnp_12345
    name = db.Column(db.String(255), nullable=False)
    store = db.Column(db.String(50), nullable=False)
    price = db.Column(db.Float, nullable=False)
    formatted_price = db.Column(db.String(20))
    image_url = db.Column(db.Text)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)

class SavedBasket(db.Model):
    __tablename__ = 'saved_baskets'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True) # Optional link to user
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    items = db.relationship('BasketItem', backref='basket', lazy=True, cascade="all, delete-orphan")

class BasketItem(db.Model):
    __tablename__ = 'basket_items'
    id = db.Column(db.Integer, primary_key=True)
    basket_id = db.Column(db.Integer, db.ForeignKey('saved_baskets.id'), nullable=False)
    product_id = db.Column(db.String(100), db.ForeignKey('products.id'), nullable=False)
    quantity = db.Column(db.Integer, default=1)

    # Relationship to directly pull Product details
    product = db.relationship('Product')

# Initialize DB tables within app context
with app.app_context():
    db.create_all()

# ==========================================
# NEW REST DATABASE ENDPOINTS
# ==========================================

@app.route('/api/db/saved-baskets', methods=['GET'])
def get_db_saved_baskets():
    """Fetches all saved baskets from the SQL database"""
    baskets = SavedBasket.query.order_by(SavedBasket.created_at.desc()).all()
    output = []
    
    for b in baskets:
        items_list = []
        for bi in b.items:
            p = bi.product
            if p:
                items_list.append({
                    'id': p.id,
                    'name': p.name,
                    'store': p.store,
                    'price': p.price,
                    'formattedPrice': p.formatted_price,
                    'imageUrl': p.image_url,
                    'quantity': bi.quantity
                })
        
        output.append({
            'id': b.id,
            'name': b.name,
            'date': b.created_at.strftime('%Y-%m-%d'),
            'items': items_list
        })
        
    return jsonify(output)


@app.route('/api/db/save-basket', methods=['POST'])
def save_basket_to_db():
    """Saves active basket & registers missing products to SQL Database"""
    data = request.json or {}
    basket_name = data.get('name', 'My Saved Basket')
    items = data.get('items', [])

    if not items:
        return jsonify({'error': 'No items in basket'}), 400

    new_basket = SavedBasket(name=basket_name)
    db.session.add(new_basket)
    db.session.flush()  # Gets generated new_basket.id

    for item in items:
        # Check if product exists in SQL DB, insert if missing
        product = Product.query.get(item['id'])
        if not product:
            product = Product(
                id=item['id'],
                name=item['name'],
                store=item['store'],
                price=float(item['price']),
                formatted_price=item.get('formattedPrice', f"R {float(item['price']):.2f}"),
                image_url=item.get('imageUrl', '')
            )
            db.session.add(product)

        # Create linked BasketItem
        basket_item = BasketItem(
            basket_id=new_basket.id,
            product_id=item['id'],
            quantity=item.get('quantity', 1)
        )
        db.session.add(basket_item)

    db.session.commit()
    return jsonify({'success': True, 'basket_id': new_basket.id})


@app.route('/api/db/saved-baskets/<int:basket_id>', methods=['DELETE'])
def delete_db_basket(basket_id):
    """Deletes a saved basket from SQL DB"""
    basket = SavedBasket.query.get(basket_id)
    if not basket:
        return jsonify({'error': 'Basket not found'}), 404
    
    db.session.delete(basket)
    db.session.commit()
    return jsonify({'success': True})