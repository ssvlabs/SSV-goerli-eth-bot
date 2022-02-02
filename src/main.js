require('discord-reply');
require('dotenv').config();
require('./db');
const web3 = require('web3');
const utils = require('./utils');
const redisStore = require('./redis');
const Logger = require('./logger.js');
const Discord = require('discord.js');
const config = require('./config/config');
const goerliBot = require('./goerliBot.js');
const bot = require('./initializers/DiscordBot');
const queueHandler = require('./queueHandler.js');
const walletSwitcher = require("./initializers/WalletSwitcher");

let allowedValidatorsAmount;
let channelIsOnline = true;

const textColor = 0xff1100;
const COMMAND_PREFIX = '+goerlieth';
const title = 'SSV Goerli Deposit Bot';
const adminID = [844110609142513675, 836513795194355765, 724238721028980756, 876421771400740874];

const EMBEDDED_HELP_MESSAGE = new Discord.MessageEmbed().setTitle(title).setColor(3447003)
    .setDescription(config.MESSAGES.MODE.HELP)
    .addField("+goerlieth <address> <hex-data>", 'To start you need to register the **wallet address** you used to generate the **hex** and the **hex** itself.')
    .addField("+goerlieth help", 'Help with the bot.')
    .addField("+goerlieth mod", "Ping the admins for help if the **BOT** is malfunctioning (spamming this will result in a **BAN**)")

bot.on('ready', async function () {
    allowedValidatorsAmount = await getAmountOfValidatorsAllowed();
    queueHandler.executeQueueList();
    Logger.log('I am ready!');
})

bot.on('message', async (message) => {
    try {
        if (!message || !message.content || message.content.substring(0, COMMAND_PREFIX.length) !== COMMAND_PREFIX) return;

        let text = '';
        const embed = new Discord.MessageEmbed()
        const args = (message.content.substring(COMMAND_PREFIX.length).split(/ |\n/)).filter(n => n)
        const address = args[0];
        const hexData = args[1];
        let channel = message.channel;

        if (0 > allowedValidatorsAmount - 1  && channelIsOnline) {
            await channel.overwritePermissions([{id: config.VERIFIED_ROLE_ID, deny: ['SEND_MESSAGES', 'ADD_REACTIONS']}]);
            channelIsOnline = true;
            return;
        }

        if (address === 'start' && adminID.includes(Number(message.author.id))) {
            allowedValidatorsAmount = await getAmountOfValidatorsAllowed();
            await channel.overwritePermissions([{id: config.VERIFIED_ROLE_ID, allow: ['SEND_MESSAGES', 'ADD_REACTIONS']}]);
            channelIsOnline = false;
            return;
        }

        // check if user request other commands
        if (address === 'help') {
            const attachment = new Discord.MessageAttachment('./src/img.png', 'img.png');
            EMBEDDED_HELP_MESSAGE.attachFiles(attachment).setImage('attachment://img.png');
            await message.lineReply(EMBEDDED_HELP_MESSAGE);
        }

        // check user's params
        if (address === 'mod') text = config.MESSAGES.MODE.MOD;
        if (!address) text = config.MESSAGES.ERRORS.NO_ADDRESS;
        if (!hexData && address && web3.utils.isAddress(address)) text = config.MESSAGES.ERRORS.INVALID_NUMBER_OF_ARGUMENTS_HEX;
        if (!hexData && address && web3.utils.isHex(address)) text = config.MESSAGES.ERRORS.INVALID_NUMBER_OF_ARGUMENTS_ADDRESS;

        if (address && hexData) {
            const isHex = web3.utils.isHexStrict(hexData);
            const isAddress = web3.utils.isAddress(address);

            if (isHex && isAddress) {
                const withCustomChecks = !adminID.includes(Number(message.author.id));
                console.log("DiscordID " + message.author.id + " is requesting " + 32 + " goerli eth.  Custom checks: " + false);
                let walletIsReady = await goerliBot.checkWalletIsReady(message)
                if (!walletIsReady) {
                    console.log("Faucet does not have enough ETH.");
                    if (message) {
                        embed.setDescription(config.MESSAGES.ERRORS.FAUCET_DONT_HAVE_ETH).setTimestamp().setColor(0xff1100);
                        await message.lineReply(embed);
                    }
                    return;
                }
                const userEligible = await goerliBot.checkUserEligibility(message, address, withCustomChecks);
                if (!userEligible) return;
                text = config.MESSAGES.SUCCESS.PROCESSING_TRANSACTION(message.author.id);
                await redisStore.addToQueue({
                    authorId: message.author.id,
                    username: message.author.username
                }, address, hexData);
            } else if (!isAddress) {
                text = config.MESSAGES.ERRORS.INVALID_ADDRESS;
            } else if (!isHex) {
                text = config.MESSAGES.ERRORS.INVALID_HEX;
            } else {
                text = config.MESSAGES.ERRORS.UNKNOWN_ERROR;
            }
        }


        if (text) {
            embed.setDescription(text).setColor(textColor).setTimestamp();
            await message.lineReply(embed);
        }

    } catch (e) {
        Logger.log(e);
        const embed = new Discord.MessageEmbed().setDescription(config.MESSAGES.ERRORS.CONTACT_THE_MODS).setColor(0xff1100).setTimestamp();
        await message.lineReply(embed);
    }
});

async function getAmountOfValidatorsAllowed() {
    const itemsInQueue = (await redisStore.getQueueItems()).length
    const addressBalance = Number(await utils.getAddressBalance(walletSwitcher.getWalletAddress()));
    console.log('Amount of validators able to register: ', (addressBalance / 32 - (itemsInQueue * 32)).toFixed())
    return (addressBalance / 32 - itemsInQueue).toFixed();
}

bot.login(process.env.SSV_DISCORD_BOT_TOKEN);