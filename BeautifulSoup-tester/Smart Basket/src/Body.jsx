import Body_image from "./assets/8ceb7c74-454f-4f98-9787-1193d443623f.png";

function Body(){

    return(
        <div>
            <div style={{justifyItems: "center"}}>
                 <hr className="divider" />
            </div>
            <section className="Category-options">
             <nav>
                <ul style={{marginLeft: "2%"}}>
                    <li><a href="">Grocery</a></li>
                    <li><a href="">Liquor</a></li>
                    <li><a href="">Pharmacy</a></li>
                    <li><a href="">Electronics</a></li>
                </ul>
            </nav>
            </section>

            <section className="Middle-items">
                <div className="Middle-items-Left">
                <p style={{fontWeight: "bold"}}>DAILY DEALS</p>
                    <br />
                <h1>Wanna buy cheap? Come browse</h1>
                <br />
                <p style={{fontSize: "15px"}}>
          SmartBasket makes grocery shopping simple, fast, and affordable.
          Browse fresh produce, pantry essentials, beverages, and household
          items all in one place, with quality products and great daily deals
          delivered right to your doorstep.
        </p>
        <br />
        <button>Explore offers</button>
      </div>
      <div className="Middle-items-Right">
        <div>
          <img src={Body_image}/>
        </div>
        <div style={{paddingLeft: "2%"}}>
          <br />
          <h4>Fresh picks for your basket</h4>
          <br />
          <p>
            Discover seasonal produce, weekly essentials and curated
            bundle-delivered fast
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "5%",
              marginBottom: "2%",
              paddingRight: "2%"
                      }}>
            <button>
              <i class="fa fa-shopping-cart" aria-hidden="true"/>
              View
              Shopping List
            </button>
            <span style={{color: "rgb(147, 147, 148)", fontSize: "13px"}}
              >1245+ items<i class="fa fa-arrow-right" aria-hidden="true"/></span>
            </div>
            </div>
            </div>
            </section>

            <section className="Discover-items">
      <div style={{justifyItems: "center"}}><h3>Discover Items</h3></div>
      <hr className="small-divider" style={{width: "35px"}} />
      <section className="Deals-section">
        <div className="">
          <div className="Top-images" style={{display: "flex"}}>
            <div className="pop-effect-image">
              <div className="left-image">
                <h4 style={{color: "#eef4fd"}}>
                  Grocery <i class="fa fa-arrow-right" aria-hidden="true"></i>
                </h4>
              </div>
            </div>
            <div>
              <div className="pop-effect-image">
                <div className="right-top">
                  <h4 style={{color: "#eef4fd"}}>
                    Liqour
                    <i class="fa fa-arrow-right" aria-hidden="true"></i>
                  </h4>
                </div>
              </div>
              <div className="Bottom" style={{display: "flex", marginTop: "0px"}}>
                <div className="watch">
                  <h4 style={{color: "#eef4fd"}}>
                    Pharmacy
                    <i class="fa fa-arrow-right" aria-hidden="true"></i>
                  </h4>
                </div>
                <div className="electronics">
                  <h4 style={{color: "#eef4fd"}}>
                    Electronics
                    <i class="fa fa-arrow-right" aria-hidden="true"></i>
                  </h4>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>

        </div>
    )
}

export default Body