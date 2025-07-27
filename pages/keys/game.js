
var GameScene = new Phaser.Scene('GameScene');
var OverScene = new Phaser.Scene('OverScene');

var config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    scene: [GameScene, OverScene]
};

var game = new Phaser.Game(config);
var gameOver = false;
var gameScore = 0;

GameScene.preload = function ()
{
   this.load.image('sky', 'assets/sky.png');
}

GameScene.create = function ()
{
    console.log("enter game scene");

    this.scene.setVisible(true);
    gameOver = false;
    gameScore = 0;

    this.add.image(400, 300, 'sky');

    // this.input.keyboard.disableGlobalCapture();
    // this.alphabet = 'QWERTYUIOPASDFGHJKL;ZXCVBNM./';

    this.alphabet = 'qwertyuiopasdfghjklzxcvbnm';

    var X = Math.floor((Math.random()*config.height)+1);
    var Y = 40;

    this.character = this.add.text(X, Y, this.alphabet.charAt(Math.floor(Math.random() * this.alphabet.length)), {fill:'#fff', fontSize: '50px',});

    this.score = this.add.text(0, 0, "Your Score: " + gameScore , {fill:'#fff', fontSize: '40px',});
    
    this.input.keyboard.on('keydown', (event) => {
        if (gameOver) {
            return;
        }

        const key = event.key;
        console.log(key);
        if (key == this.character.text) {
            gameScore ++;
            this.character.x = Math.floor((Math.random()*config.height)+1);
            this.character.y = 40;
            this.character.text = this.alphabet.charAt(Math.floor(Math.random() * this.alphabet.length));
        } else {
            if (gameScore > 0) {
                gameScore --;
            }
        }
    });

    this.characterTimer = this.time.addEvent({
        delay: 500,
        callback: () => {
            this.character.y += 15;
            if (this.character.y > config.height) {
                console.log("game over");

                this.characterTimer.remove();

                this.scene.setVisible(false);
                game.scene.start('OverScene');
            }
        },
        loop: true,
    });
}

GameScene.update = function ()
{
    this.score.text = "Your Score: " + gameScore;
}


OverScene.preload = function ()
{
   this.load.image('sky', 'assets/sky.png');
}

OverScene.create = function ()
{
    console.log("enter game over scene");
    this.scene.setVisible(true);

    gameOver = true;

    var bg = this.add.image(400, 300, 'sky');
    // bg.width = this.world.width;
    // bg.height = this.world.height;

    var title = this.add.text(config.width / 3, config.height * 0.25, 'Game Over', {
        fontSize: '40px',
        fontWeight: 'bold',
        fill: '#ffffffff'
    });

    var scoreStr = "Your Score: " + gameScore;
    var scoreText = this.add.text(config.width / 3, config.height * 0.25 + 50, scoreStr, {
        fontSize: '30px',
        fontWeight: 'bold',
        fill: '#ffffffff'
    });

    /*
    const button = this.add.text(config.width / 3, config.height * 0.25 + 50 + 50, 'Restart', {
        fontSize: '40px',
        fontWeight: 'bold',
        fill: '#ffffffff'
    });
    button.on('pointerdown', () => {
        console.log('button press');

        if (!gameOver) {
            return;
        }
        console.log("game over keydown");

        this.scene.setVisible(false);
        game.scene.start('GameScene');
    });
    */

    this.input.keyboard.on("keydown-ENTER", (event) => {
        if (!gameOver) {
            return;
        }
        console.log("game over keydown");

        this.scene.setVisible(false);
        game.scene.start('GameScene');
    });
}

OverScene.update = function ()
{
}


/*
function gameOverScene() {
    var score = 0;
    this.init = function() {
        score = arguments[0];
    }
    this.create = function() {
        // 添加背景
        var bg = game.add.image(0, 0, 'bg');
        bg.width = game.world.width;
        bg.height = game.world.height;
        // 添加文本
        var title = game.add.text(game.world.centerX, game.world.height * 0.25, '游戏结束', {
            fontSize: '40px',
            fontWeight: 'bold',
            fill: '#f2bb15'
        });
        title.anchor.setTo(0.5, 0.5);
        var scoreStr = '你的得分是：'+score+'分';
        var scoreText = game.add.text(game.world.centerX, game.world.height * 0.4, scoreStr, {
            fontSize: '30px',
            fontWeight: 'bold',
            fill: '#f2bb15'
        });
        scoreText.anchor.setTo(0.5, 0.5);
    }
}
*/