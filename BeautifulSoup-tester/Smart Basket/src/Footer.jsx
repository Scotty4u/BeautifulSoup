import twitter from "./assets/twitter.jpg";
import instagram from "./assets/instagram-6338393_1280.webp";
import facebook from "./assets/facebook-logo-facebook-icon-transparent-free-png.webp";

function Footer(){

    return (
        <div style={{display:"flex", justifyContent:"space-evenly"}}>
        <div style={{ width: "300px" ,marginLeft: "-100px" ,marginTop: "25px"}}>
        <div style={{display: "flex"}}>
          <i
          class="fas fa-shopping-bag"
          style={{fontSize: "30px", color: "black", marginRight: "8px"}}
        ></i>
        <h2>SmartBasket</h2>
        </div>
        <p style={{color: "black"}}>SmartBasket makes grocery shopping simple, fast, and affordable. Browse fresh produce, pantry essentials, beverages, and household items all in one place, with quality products and great daily deals delivered right to your doorstep.</p>
      </div>
      
      <div className="form" style={{marginTop: "5px"}}>
        <section className="form">
        <form action="\submit_form" method="post">
          <label htmlFor="name" style={{color: "black"}}>Name:</label><br/>
          <input type="text" name="name" id="name" style={{background:"#eef4fd", height: "25px" ,borderRadius: "5px"}} required/><br />
          <label htmlFor="surname" style={{color: "black"}}>Surname:</label><br />
          <input type="text" name="surname" id="surname" style={{background:"#eef4fd", height: "25px" ,borderRadius: "5px"}}  required /><br />
          <label htmlFor="phone" style={{color: "black"}}>Phone:</label><br />
          <input type="tel" name="phone" id="phone" style={{background:"#eef4fd", height: "25px" ,borderRadius: "5px"}} required /><br />
          <label htmlFor="email" style={{color: "black"}}>Email:</label><br />
          <input type="email" name="email" id="email" style={{background:"#eef4fd", height: "25px" ,borderRadius: "5px"}}  required /><br /><br />

          <label htmlFor="budget"style={{color:"black"}} > Budget Range:</label><br />
          <select name="Budget_Range" id="Budget_Range" style={{height: "25px", width: "200px"}}>
            <optgroup label="Min-Max">
              <option value="">R100-R300</option>
              <option value="">R300-R500</option>
              <option value="">R500-R1000</option>
              <option value="">R1000-R30000</option>
              <option value="">R3000-R5000</option>
            </optgroup>
            </select>
            <br />
            <br />
          <input type="submit" id="button" value="Request !!"/>
          <br/>
        </form>
        </section>
      </div>

      <section className="Icons" style={{marginTop: "25px"}}>
        <div className="facebook" style={{display: "flex"}}>
          <img
           src={facebook}
            style={{width: "50px", height: "50px", borderRadius: "360%"}}
          />
          <p style={{color: "black", marginLeft: "20px", marginTop: "18px"}}>@SmartBasket</p>

        </div>

        <div className="twitter" style={{display: "flex"}}>
          <img
            src={twitter}
            style={{width: "50px", height: "50px", borderRadius: "360%"}}
          />
          <p style={{color: "black", marginLeft: "20px", marginTop: "18px"}}>@SmartBasket</p>
        </div>

        <div className="instagram" style={{display: "flex"}}>
          <img
            src={instagram}
            style={{width: "50px", height: "50px", borderRadius: "360%"}}
          />
          <p style={{color: "black", marginLeft: "20px", marginTop: "18px"}}>@SmartBasket</p>
        </div>
      </section>

      </div>
    );
}

export default Footer;