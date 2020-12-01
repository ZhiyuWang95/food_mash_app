require('dotenv').config()
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const ejs = require('ejs');
const yelp = require('yelp-fusion');
const url = require('url');
const session = require('express-session');
const passport = require('passport');
const passportLocalMongoose = require('passport-local-mongoose');
//const GoogleStrategy = require('passport-google-oauth20').Strategy;

const myAPI = process.env.YELP_API;
const client = yelp.client(myAPI);
const mongodb_url = process.env.MONGODB_URL

const app = express();

app.use(bodyParser.urlencoded({extended: true}));
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));
app.use(
    session({
        secret: "our little secret.",
        resave: false,
        saveUninitialized: false
    })
);
app.use(passport.initialize());
app.use(passport.session());


mongoose.set('useCreateIndex', true);
mongoose.connect(mongodb_url,{useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false });

//The userSchema has to be a mongoose schema to be able to plugin module
//So it cannot be just a JS object
const winnerSchema = {
    name: String,
    image: String,
    website: String,
}

const searchSchema = {
    user: String,
    city: String,
    term: String,
    limit: Number,
    index: Number,
    candidates: [winnerSchema],
    winners: [winnerSchema]
}

const userSchema = new mongoose.Schema({
    email: String,
    password: String,
    history: [String]
});

userSchema.plugin(passportLocalMongoose);

// passport.use(new GoogleStrategy({
//     clientID: process.env.CLIENT_ID,
//     clientSecret: process.env.CLIENT_SECRET,
//     callbackURL: "http://localhost:3000/auth/google/home/"
//   },
//   function(accessToken, refreshToken, profile, cb) {
//     User.findOrCreate({ googleId: profile.id }, function (err, user) {
//       return cb(err, user);
//     });
//   }
// ));


const User = new mongoose.model("user", userSchema);
passport.use(User.createStrategy());

passport.serializeUser(function(user, done){
    done(null, user.id);
});
passport.deserializeUser(function(id, done){
    User.findById(id, function(err, user){
        done(err, user);
    });
});

const Search = mongoose.model("search", searchSchema);
const Winner = mongoose.model("winner", winnerSchema);



//app starts
app.get('/', (req, res) => {
    if(req.isAuthenticated()) {
        console.log("user is authenticated");
        console.log(req);
        res.render('home', {username: req.user.username});
    }else{
        res.render('home', {username: ""});
    }
});

// app.get('/user', (req, res) => {
//     let user_id = req.user._id;
//     let history = req.user.history;
//     let search_list = [];
//     history.forEach((search_id)=> {
//         Search.findOne(
//             {_id: search_id},
//             (err, foundSearch) => {
//                 search_list.push(foundSearch);
//             }
//         );
//     });
//     res.render('user', {username: req.user.username, name: req.user.username, search_food: search_list[0].name});
// });

app.get('/logout', (req, res) => {
    req.logOut();
    res.redirect('/');
});


app.get('/result', (req, res) => {
    let search_id = req.query.search_id;
    console.log(search_id);
    Search.findOne(
        {_id: search_id},
        (err, foundSearch) => {
            if(err) {
                console.log(err);
            } else {
                let winners = foundSearch.winners;
                console.log(winners)
                if(winners.length === 1) {
                    res.render('result', {
                        title: search_id,
                        city: foundSearch.city,
                        term: foundSearch.term,
                        final_winner: winners[0].name,
                        winner_image: winners[0].image,
                        winner_web: winners[0].website,
                        username: search_id
                    });
                }
            }
        }
    );
});

app.get('/login', (req, res) => {
    res.render('login', {username: "", errormessage: ''});
});

app.get('/register', (req, res) => {
    res.render('register', {username: "", errormessage: ''});
});

function updateSearch(username, search_id, res) {
    Search.findOne(
        {_id: search_id},
        (err, foundSearch) => {
            if(err) {
                console.log(err);
            } else {
                let index = foundSearch.index;
                let candiList = foundSearch.candidates;
                let candi1 = candiList[index];
                let candi2 = candiList[index+1];
                res.render('race', {
                    title: search_id+"race", 
                    food1_img: candi1.image,
                    food1_name: candi1.name,
                    food1_web: candi1.website,
                    food2_img: candi2.image,
                    food2_name: candi2.name,
                    food2_web: candi2.website,
                    username: username,
                    search_id: search_id
                });
            }
        }
    );
}

app.get('/race', (req, res) => {
    let search_id = req.query.search_id;
    if(req.isAuthenticated()) {
        let username = req.user.username;
        updateSearch(username, search_id, res);
    }else{
        updateSearch("", search_id, res);
    }
});


//POST callbacks:
function updateUserHistory(user_id, search_id) {
    User.findOne(
        {_id: user_id},
        (err, foundUser) => {
            if(err) {
                console.log(err);
            } else {
                foundUser.history.push(search_id);
                foundUser.save();
            }
        }
    );
}


app.post('/', function(req, res){
    term = req.body.term;
    city = req.body.city;
    limit = parseInt(req.body.number);
    let search_id = "";

    const newSearch = new Search({
        user: "",
        city: city,
        term: term,
        limit: limit,
        index: 0
    });

    newSearch.save((err, record) => {
        search_id = record.id;
    });


    client.search({ term: term, location: city, limit: limit}).then(response => {
        let businesses=response.jsonBody.businesses;
        businesses.forEach(function(food) {
            const candi_food = new Winner({
                name: food.name,
                image: food.image_url,
                website: food.url
            });
            Search.findOneAndUpdate(
                {_id: search_id},
                { $push: { candidates: candi_food } },
                (err, foundSearch) => {
                    if(err) {
                        console.log(err);
                    }
                }
            );
        });

        if(req.isAuthenticated()) {
            let user_id = req.user._id;
            updateUserHistory(user_id, search_id);
        } 
        res.redirect(
            url.format({
                pathname:"/race",
                query: {
                    "search_id": search_id
                },
            })
        );
    });
});


app.post('/race', (req, res) => {
    let winner_name = req.body.win;
    let search_id = req.body.search_id;

    Search.findOne(
        {_id: search_id},
        (err, foundSearch) => {
            if(err) {
                console.log(err);
            } else {
                let index = foundSearch.index;
                let candiList = foundSearch.candidates;
                let candi1 = candiList[index];
                let candi2 = candiList[index+1];
                if(winner_name == candi1.name) {
                    foundSearch.winners.push(candi1);
                }else{
                    foundSearch.winners.push(candi2);
                }
                index += 2;

                if(index >= candiList.length) {
                    if(foundSearch.winners.length == 1) {
                        foundSearch.index = 0;
                        foundSearch.save();
                        res.redirect(
                            url.format({
                                pathname:"/result",
                                query: {
                                    "search_id": search_id
                                },
                            })
                        );
                    }else{
                        foundSearch.candidates = foundSearch.winners;
                        foundSearch.winners = [];
                        foundSearch.index = 0;
                        foundSearch.save();
                        res.redirect(
                            url.format({
                                pathname:"/race",
                                query: {
                                    "search_id": search_id
                                },
                            })
                        );
                    }
                }else{
                    foundSearch.index = index;
                    foundSearch.save();
                    res.redirect(
                        url.format({
                            pathname:"/race",
                            query: {
                                "search_id": search_id
                            },
                        })
                    );
                }
            }
        }
    );
});

app.post('/register', (req, res) => {
    User.register({username: req.body.username, active: true}, req.body.password, function(err, user) {
        if (err) {
            console.log(err);
            res.redirect('/register');
        } else {
            passport.authenticate("local")(req, res, function(){
                res.redirect('/');
            });
        }
      });
});

app.post('/login', (req, res) => {
    const user = new User({
        email: req.body.username,
        password: req.body.password
    });

    req.login(user, (err) => {
        if(err) {
            console.log(err);
        }else{
            passport.authenticate("local")(req, res, function(){
                res.redirect('/');
            });
        }
    })
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server has been started on Port:"+PORT);
});