// Load in the required modules
const Patches = require('Patches');
const Diagnostics = require('Diagnostics');
const Multipeer = require('Multipeer');
const Participants = require('Participants');
const Time = require('Time');
const Reactive = require('Reactive');
const Scene = require('Scene');
const Materials = require('Materials');
const Random = require('Random');

(async function () { // Enable async/await in JS [part 1]

  let debug = true

  // Get the current participant, 'self'
  const self = await Participants.self;
  Patches.inputs.setString("playerID", self.id.substring(self.id.length-4,self.id.length));

  var playersReady = {}
  var playersPlaying = {}

  const scriptLoadedChannel = Multipeer.getMessageChannel("ScriptLoaded");
  scriptLoadedChannel.onMessage.subscribe((msg) => {
    // Diagnostics.log("Received message " + JSON.stringify(msg));
    if(msg.destination && msg.destination != self.id){
      return;
    }
    playersReady[msg.source] = true
    onSomeoneReady(msg.source)

    if(!msg.destination && gameIsFinished){
      scriptLoadedChannel.sendMessage({ // Reply only to the source that we also are ready
        "source": self.id,
        "destination" : msg.source
      });
    }
  });

  var myEffects = ""

  const moveChannel = Multipeer.getMessageChannel("move");
  moveChannel.onMessage.subscribe((msg) => {
    onSomeoneMoved(msg.id, msg.move)
  });

  const scoreChannel = Multipeer.getMessageChannel("score");
  scoreChannel.onMessage.subscribe((msg) => {
    onSomeoneScored(msg.id, msg.score)
  });

  const roundChannel = Multipeer.getMessageChannel("round");
  roundChannel.onMessage.subscribe((msg) => {
    if(gameIsFinished) startRound()
  });

  const effectsChannel = Multipeer.getMessageChannel("effects");
  effectsChannel.onMessage.subscribe((msg) => {
    if(!myEffects.includes(msg.effect)) myEffects += msg.effect + "|"
    Diagnostics.log("My effects = " + myEffects + ".")
    Patches.inputs.setString('myEffects', myEffects)
  });

  const selectRock     = await Patches.outputs.getPulse('selectRock');        selectRock.subscribe(() => {select("Rock"    )});
  const selectPaper    = await Patches.outputs.getPulse('selectPaper');      selectPaper.subscribe(() => {select("Paper"   )});
  const selectScissors = await Patches.outputs.getPulse('selectScissors');selectScissors.subscribe(() => {select("Scissors")});

  const myMoveRect = await Scene.root.findFirst("myMoveRect")

  const rockMaterial        = await Materials.findFirst('rockMaterial')
  const paperMaterial       = await Materials.findFirst('paperMaterial')
  const scissorsMaterial    = await Materials.findFirst('scissorsMaterial')
  const transparentMaterial = await Materials.findFirst('transparentMaterial')

  function select(selectedValue){
    selection = selectedValue;
    //Diagnostics.log("Currently selecting " + selection);
    Patches.inputs.setString('selection', selection);
    switch(selection){
      case "Rock"     : myMoveRect.material = rockMaterial;        break;
      case "Paper"    : myMoveRect.material = paperMaterial;       break;
      case "Scissors" : myMoveRect.material = scissorsMaterial;    break;
      default         : myMoveRect.material = transparentMaterial; break;
    }
  }

  // let didIStartThisGame = false

  let movesToReceiveBeforeScoring = 0
  let scoresToReceive = 0

  let myMove = "Chicken"
  select("Chicken")
  let allOtherMoves = []

  let myScore = 0
  let allOtherScores = []

  let onUserLeft = function(id){}

  let failSafeTimer

  let onEveryoneMoved = function(){
    Time.clearTimeout(failSafeTimer);
    onUserLeft = function(id){
      onSomeoneScored(id, null)
    };

    // if (debug) Patches.inputs.setString('setDebugText', "Waiting\n3 seconds.")

    Patches.inputs.setPulse('showMove', Reactive.once());

    // Starts a 3 seconds timer before counting our score, for seeing moves made by everyone
    let timer = Time.setTimeout(function() {
      let pointsObtained = computeScoreChange(myMove,allOtherMoves)
      Diagnostics.log("Points obtained : " + pointsObtained + " by playing '" + myMove + "' against " + JSON.stringify(allOtherMoves) + ".");

      myScore += pointsObtained;
      scoreChannel.sendMessage({
        id : self.id,
        score : myScore
      });

      Patches.inputs.setString('score', myScore.toString());
      Patches.inputs.setString('pointsObtained', pointsObtained > 0 ? "+ " + pointsObtained.toString() : "- " + (-pointsObtained).toString());
      Patches.inputs.setPulse('pointsObtainedPulse', Reactive.once());

      // Failsafe : in case some user left the filter or lost the connection during a round, we will stop waiting for its result after a few seconds
      failSafeTimer = Time.setTimeout(function(){
        if(scoresToReceive > 0){
          Diagnostics.warn("10 seconds passed after scoring, some scores are still missing.")
          endGame()
        }
      }, 10000);

      onSomeoneScored(self.id, myScore)

    }, 3000);
  }

  let onSomeoneMoved = function(id, move){
    // Debug prints
    // Diagnostics.log(id + " move has changed from '" + event.oldValue + "' to '" + event.newValue + "'");
    if(id != self.id && move != "") Diagnostics.log(id + " played '" + move + "'.");

    movesToReceiveBeforeScoring--

    // Discard unwanted datas
    if(movesToReceiveBeforeScoring < 0){
      Diagnostics.log("Received a move while not waiting any move (anymore).")
      movesToReceiveBeforeScoring = 0;
      return;
    }

    // Save into local structures
    if(self.id != id) allOtherMoves.push(move)

    // React if all data has been received
    if(movesToReceiveBeforeScoring == 0){
      onEveryoneMoved()
    }
    else {
      // if (debug) Patches.inputs.setString('setDebugText', "Waiting for\n" + movesToReceiveBeforeScoring + " moves.")
      Diagnostics.log("Expecting " + movesToReceiveBeforeScoring + " more moves before counting...")
    }
  };

  let possibleEffects = [
    {"name" : "clownNose"}
   ,{"name" : "drunkMarker"}
   ,{"name" : "slugEyes"}
   ,{"name" : "bananas"}
   ,{"name" : "potatoes"}
  ]

  let onEveryoneScored = function(){
    Time.clearTimeout(failSafeTimer);
    onUserLeft = function(id){};

    // Winner calculation
    let win = allOtherScores.length > 0
    for(let key in allOtherScores){
      let score = allOtherScores[key]
      if(myScore <= score){
        win = false;
        break;
      }
    }

    if(win){
      (async function () {
        let effect = possibleEffects[Math.round(1000000 * Random.random()) % possibleEffects.length]
        
        // Inflicts an effect
        effectsChannel.sendMessage({
          effect : effect.name
        })

        let allMyPreviousEffects = myEffects.split("|")
        allMyPreviousEffects.shift() // Remove first
        myEffects = allMyPreviousEffects.join("|");
        Diagnostics.log("My effects = " + myEffects + ".")
        Patches.inputs.setString('myEffects', myEffects)
      })();
    }

    Patches.inputs.setBoolean('win', win);
    Patches.inputs.setPulse('roundFinished', Reactive.once());

    let highestScore = myScore
    let highestScoreCount = 1
    for(let i = 0; i < allOtherScores.length; i++){
      let score = allOtherScores[i]
      if(highestScore < score){
        highestScore = score;
        highestScoreCount = 1;
      }
      else if(highestScore == score){
        highestScoreCount++;
      }
    }
    // Diagnostics.log("The highest score is actually " + highestScore + " and " + highestScoreCount + " player haves it.")
    if(highestScoreCount > 1){ // If there is no winner yet
      startRound() // We launch the next round automatically
    }
    else { // Someone won.
      endGame()
    }
  }

  let onSomeoneScored = function(id, score){
    scoresToReceive--

    // Discard unwanted datas
    if(scoresToReceive < 0){
      if(!gameIsFinished) Diagnostics.log("Received a score while not waiting any score (anymore).")
      scoresToReceive = 0;
      return;
    }

    // Save into local structures
    if(self.id != id && score !== null) {
        allOtherScores.push(score);
    }

    // React if all data has been received
    if(scoresToReceive == 0){
      onEveryoneScored()
    }
    else {
      // if (debug) Patches.inputs.setString('setDebugText', "Waiting\n" + scoresToReceive + " scores.")
      Diagnostics.log("Expecting " + scoresToReceive + " more scores update before allowing new round...")
    }
  }

  function computeScoreChange(myMove, allOtherMoves){
    let scoreChange = 0
    let allTheOthersPlayedChicken = true

    for(let i = 0; i < allOtherMoves.length; i++){
      let otherMove = allOtherMoves[i]

      if(otherMove != "Chicken") allTheOthersPlayedChicken = false

      if(myMove == "Rock"){
        if      (otherMove == "Rock")    {} 
        else if (otherMove == "Paper")   scoreChange--
        else if (otherMove == "Scissors") scoreChange++
      }
      else if(myMove == "Paper"){
        if      (otherMove == "Rock")    scoreChange++ 
        else if (otherMove == "Paper")   {}
        else if (otherMove == "Scissors") scoreChange--
      }
      else if(myMove == "Scissors"){
        if      (otherMove == "Rock")    scoreChange-- 
        else if (otherMove == "Paper")   scoreChange++
        else if (otherMove == "Scissors") {}
      }
    }

    // Extra rule : if you don't play chicken, but all the others do, you win something
    if(myMove != "Chicken" && allTheOthersPlayedChicken && allOtherMoves.length > 0){
      scoreChange++
    }

    return scoreChange
  }

  let selection = "Chicken"

  let gameIsFinished = true
  const startGame = await Patches.outputs.getPulse('startGame');
  startGame.subscribe(function() {
    (async function () {
      // Everyone needs to be ready to start a game
      const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
      for(let key in othersParticipants){
        let id = othersParticipants[key].id
        if(playersReady[id]){
          continue
        }
        else{
          // Reject the start request
          return;
        }
      }

      if(othersParticipants.length == 0){
        // Reject the start request
        return;
      }

      if (gameIsFinished) {
        // didIStartThisGame = true
        roundChannel.sendMessage({
          id : self.id
        })
        startRound()
      }
      else {
        Diagnostics.log("Cannot start a new round because a round has started and all moves are not empty again.");
      }
    })();
  });

  let startRound = function(){
    let gameJustStarted = false
    if(gameIsFinished){
      Diagnostics.log("Starting game.");
      gameJustStarted = true
      myScore = 0
      Patches.inputs.setString('score', myScore.toString());
    }

    Diagnostics.log("Starting round.");

    movesToReceiveBeforeScoring = 0
    scoresToReceive = 0
    select("Chicken")
    myMove = "Chicken"
    allOtherMoves = []
    allOtherScores = []
    gameIsFinished = false;

    Patches.inputs.setBoolean('win', false);
    Patches.inputs.setBoolean('canStart', false)
    Patches.inputs.setPulse('roundStarted', Reactive.once());

    (async function () {
      if (gameJustStarted){
        const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
        for(let key in othersParticipants){
          let id = othersParticipants[key].id
          if(playersReady[id]){
            playersPlaying[id] = true
          }
          playersReady[id] = false
        }
        playersPlaying[self.id] = true
      }

      let countOfParticipantsPlaying = 0
      for(let key in playersPlaying){
        if(playersPlaying[key]) countOfParticipantsPlaying++
      }

      movesToReceiveBeforeScoring = countOfParticipantsPlaying
      scoresToReceive             = countOfParticipantsPlaying
      Diagnostics.log("Round started with " + countOfParticipantsPlaying + " participants.");
    })();
    
    onUserLeft = function(id){
      scoresToReceive--
      onSomeoneMoved(id, "Chicken")
    };

    // Starts a 10 seconds timer
    let timer = Time.setTimeout(function() {
      Patches.inputs.setPulse('waitingForResults', Reactive.once());
      Diagnostics.log("10 seconds passed : You played '" + selection + "'.")
      moveChannel.sendMessage({
        id : self.id,
        move : selection
      });
      myMove = selection;
      
      // Failsafe : in case some user left the filter or lost the connection during a round, we will stop waiting for its result after a few seconds
      failSafeTimer = Time.setTimeout(function(){
        if(movesToReceiveBeforeScoring > 0){
          Diagnostics.log("10 seconds passed after play, some results are still missing.")
          endGame()
        }
      }, 10000);

      onSomeoneMoved(self.id, selection)

    }, 8000);
  };

  let endGame = function(){
    Time.clearTimeout(failSafeTimer);
    gameIsFinished = true;

    for(let key in playersPlaying){
      playersPlaying[key] = false
    }

    scriptLoadedChannel.sendMessage({ // Confirm to everyone that we are again ready to play
        "source": self.id
    });
    onSomeoneReady(self.id)
  }

  let everyoneIsReady = false

  let onSomeoneReady = async function(id){
    let canStart = true
    Diagnostics.log(id + " is now ready.")

    const othersParticipants = await Participants.getOtherParticipantsInSameEffect();
    for(let key in othersParticipants){
      let id = othersParticipants[key].id
      if(playersReady[id]){
        continue
      }
      else {
        if (debug) Patches.inputs.setString('setDebugText', "Waiting\nplayer " + id.substring(id.length-4,id.length) + "!")
        Diagnostics.log(id + " is not ready.")
        canStart = false;
        everyoneIsReady = false;
        break;
      }
    }

    if(othersParticipants.length == 0){
      if (debug) Patches.inputs.setString('setDebugText', "Waiting for\nanother player.")
    }

    if(canStart && othersParticipants.length > 0 && gameIsFinished){
      if (debug) Patches.inputs.setString('setDebugText', "")
      Patches.inputs.setBoolean('canStart', true)
      everyoneIsReady = true
    }
  }

  // Get the other call participants
  const activeParticipants = await Participants.getOtherParticipantsInSameEffect();
  activeParticipants.push(self);

  Patches.inputs.setString('score', "0");

  // --------------------------------------------------------------------------------------------
  // Get the other call participants
  const participants = await Participants.getAllOtherParticipants();

  // Get each participant in the participant list
  participants.forEach(function(participant) {

    // Monitor each participant's isActiveInSameEffect status
    // The use of subscribeWithSnapshot here allows us to capture the participant who
    // triggered the event (ie enters or leaves the call) inside of the callback
    participant.isActiveInSameEffect.monitor().subscribeWithSnapshot({
      userIndex: participants.indexOf(participant),
    }, function(event, snapshot) {

      // Pass the participant and their active status to the custom function
      onUserEnterOrLeave(snapshot.userIndex, event.newValue);
    });
  });

  // Monitor when a new participant joins
  Participants.onOtherParticipantAdded().subscribe(function(participant) {

    // Add them to the main participant list
    participants.push(participant);

    // Monitor their isActiveInSameEffect status
    participant.isActiveInSameEffect.monitor({fireOnInitialValue: true}).subscribeWithSnapshot({
      userIndex: participants.indexOf(participant),
    }, function(event, snapshot) {

      // Pass the participant and their isActiveInSameEffect status to the custom function
      onUserEnterOrLeave(snapshot.userIndex, event.newValue);
    });
  });

  // If a user joined, isActive will be true. Otherwise it will be false
  function onUserEnterOrLeave(userIndex, isActive) {

    // Get the participant that triggered the change in the participant list
    let participant = participants[userIndex];

    // Check if the participant exists in the activeParticipants list
    let activeParticipantCheck = activeParticipants.find(activeParticipant => {
      return activeParticipant.id === participant.id
    });

    if (isActive) {

      // If the participant is found in the active participants list
      if (activeParticipantCheck === undefined) {

        // Add the participant to the active participants list
        activeParticipants.push(participant);

        Diagnostics.log("User " + participant.id + " joined the effect");
        Patches.inputs.setBoolean('canStart', false)
        if (debug) Patches.inputs.setString('setDebugText', "Waiting\nplayer " + participant.id.substring(participant.id.length-4, participant.id.length) + "!")
      }
    } else {

      // If the participant is not found in the active participants list
      if (activeParticipantCheck !== undefined) {

        // Update the active participants list with the new participant
        let activeIndex = activeParticipants.indexOf(activeParticipantCheck);

        activeParticipants.splice(activeIndex, 1);

        Diagnostics.log("User " + participant.id + " left the effect");
        playersReady[participant.id] = false
        playersPlaying[participant.id] = false
        onUserLeft(participant.id)
      }
    }
  }

  scriptLoadedChannel.sendMessage({
      "source": self.id
  });
  onSomeoneReady(self.id)

  // As long as we are not in a game, and that we can't start because someone has not confirmed they were ready, we repeat every few seconds that we are ready
  const readyRepeater = Time.setInterval(function(){
    if(gameIsFinished && !everyoneIsReady){
      Diagnostics.log("The game is finished and everyone is not ready yet.")
      scriptLoadedChannel.sendMessage({
          "source": self.id
      });
      onSomeoneReady(self.id)
    }
  }, 5000);

  Diagnostics.log("Game loaded for " + self.id + " !")
})(); // Enable async/await in JS [part 2]
