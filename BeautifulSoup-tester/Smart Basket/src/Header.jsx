
function Header(){
    return(
        <header>
            
            <div>
                <i 
                className="fas fa-shopping-bag" 
                     style={{ fontSize: "30px", color: "black", marginRight: "8px" }}></i>
                <p class="brand-name">Smart Basket</p>
            </div>
            <div class="right-side">
        <div class="search-box">
          <input type="text" placeholder="Search products..." />
          <i class="fa-solid fa-magnifying-glass"></i>
        </div>
      </div>
      <div class="Content-right">
        <i class="fa-regular fa-user" style={{ marginRight: "30px"}}></i>
        <i class="fa-regular fa-heart" style={{marginRight: "30px"}}></i>
        <i class="fa-solid fa-cart-shopping"></i>
      </div>

        </header>
    );

}
export default Header