# Database tables

# Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.


# Naming conventions
# 1. Table names are lowercase plural
# 2. Join table names are snake_case plural
# 3. Column names have a table prefix
# 4. Foreign key names match primary key of foreign table


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `addresses`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `addresses` (
  `addrID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `addrAddress` varchar(74) DEFAULT NULL,
  PRIMARY KEY (`addrID`),
  UNIQUE KEY `addrAddress` (`addrAddress`)
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `banned_addresses`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `banned_addresses` (
  `bannedAddressId` int(11) NOT NULL AUTO_INCREMENT,
  `addrAddress` varchar(35) NOT NULL,
  PRIMARY KEY (`bannedAddressId`),
  UNIQUE KEY `banned_addresses_addresses` (`addrAddress`)
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `blocks`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `blocks` (
  `blockID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `blockHash` char(64) NOT NULL DEFAULT '',
  `blockParent` int(10) unsigned DEFAULT NULL,
  `blockHeight` int(10) unsigned NOT NULL DEFAULT '0',
  `blockTime` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`blockID`),
  UNIQUE KEY `blockHash` (`blockHash`),
  KEY `blockParent` (`blockParent`),
  KEY `blockHeight` (`blockHeight`),
  CONSTRAINT `blocks_ibfk_1` FOREIGN KEY (`blockParent`) REFERENCES `blocks` (`blockID`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hd`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `hd` (
  `hdID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `hdXpub` char(112) DEFAULT NULL,
  `hdCreated` int(10) unsigned NOT NULL DEFAULT '0',
  `hdType` smallint(5) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`hdID`),
  UNIQUE KEY `hdXpub` (`hdXpub`),
  KEY `hdCreated` (`hdCreated`)
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hd_addresses`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `hd_addresses` (
  `hdAddrID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `hdID` int(10) unsigned NOT NULL DEFAULT '0',
  `addrID` int(10) unsigned NOT NULL DEFAULT '0',
  `hdAddrChain` smallint(5) unsigned NOT NULL DEFAULT '0',
  `hdAddrIndex` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`hdAddrID`),
  UNIQUE KEY `hdID_2` (`hdID`,`addrID`),
  KEY `hdID` (`hdID`),
  KEY `addrID` (`addrID`),
  CONSTRAINT `hd_addresses_ibfk_1` FOREIGN KEY (`hdID`) REFERENCES `hd` (`hdID`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `hd_addresses_ibfk_2` FOREIGN KEY (`addrID`) REFERENCES `addresses` (`addrID`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inputs`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `inputs` (
  `inID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `outID` int(10) unsigned NOT NULL DEFAULT '0',
  `txnID` int(10) unsigned NOT NULL DEFAULT '0',
  `inIndex` int(10) unsigned NOT NULL DEFAULT '0',
  `inSequence` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`inID`),
  UNIQUE KEY `txnID_2` (`txnID`,`inIndex`),
  KEY `outID` (`outID`),
  KEY `txnID` (`txnID`),
  CONSTRAINT `inputs_ibfk_1` FOREIGN KEY (`txnID`) REFERENCES `transactions` (`txnID`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `inputs_ibfk_2` FOREIGN KEY (`outID`) REFERENCES `outputs` (`outID`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `outputs`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `outputs` (
  `outID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `txnID` int(10) unsigned NOT NULL DEFAULT '0',
  `addrID` int(10) unsigned NOT NULL DEFAULT '0',
  `outIndex` int(10) unsigned NOT NULL DEFAULT '0',
  `outAmount` bigint(20) unsigned NOT NULL DEFAULT '0',
  `outScript` varchar(20000) NOT NULL DEFAULT '',
  PRIMARY KEY (`outID`),
  UNIQUE KEY `txnID_2` (`txnID`,`addrID`,`outIndex`),
  KEY `txnID` (`txnID`),
  KEY `addrID` (`addrID`),
  CONSTRAINT `outputs_ibfk_1` FOREIGN KEY (`txnID`) REFERENCES `transactions` (`txnID`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `outputs_ibfk_2` FOREIGN KEY (`addrID`) REFERENCES `addresses` (`addrID`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `transactions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `transactions` (
  `txnID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `txnTxid` char(64) DEFAULT NULL,
  `txnCreated` int(10) unsigned NOT NULL DEFAULT '0',
  `txnVersion` int(10) unsigned NOT NULL DEFAULT '0',
  `txnLocktime` int(10) unsigned NOT NULL DEFAULT '0',
  `blockID` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`txnID`),
  UNIQUE KEY `txnTxid` (`txnTxid`),
  KEY `txnCreated` (`txnCreated`),
  KEY `blockID` (`blockID`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`blockID`) REFERENCES `blocks` (`blockID`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scheduled_transactions`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE IF NOT EXISTS `scheduled_transactions` (
  `schID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `schTxid` char(64) NOT NULL DEFAULT '',
  `schCreated` int(10) unsigned NOT NULL DEFAULT '0',
  `schRaw` varchar(50000) NOT NULL DEFAULT '',
  `schParentID` int(10) unsigned DEFAULT NULL,
  `schParentTxid` char(64) DEFAULT '',
  `schDelay` int(10) unsigned NOT NULL DEFAULT '0',
  `schTrigger` int(10) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`schID`),
  UNIQUE KEY `schTxid` (`schTxid`),
  KEY `schParentID` (`schParentID`),
  CONSTRAINT `scheduled_transactions_ibfk_1` FOREIGN KEY (`schParentID`) REFERENCES `scheduled_transactions` (`schID`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
