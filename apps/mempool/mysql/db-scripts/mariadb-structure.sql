SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

CREATE TABLE `blocks` (
  `height` int(11) NOT NULL,
  `hash` varchar(65) NOT NULL,
  `size` int(11) NOT NULL,
  `weight` int(11) NOT NULL,
  `minFee` int(11) NOT NULL,
  `maxFee` int(11) NOT NULL,
  `time` int(11) NOT NULL,
  `fees` double NOT NULL,
  `nTx` int(11) NOT NULL,
  `medianFee` double NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `statistics` (
  `id` int(11) NOT NULL,
  `added` datetime NOT NULL,
  `unconfirmed_transactions` int(11) UNSIGNED NOT NULL,
  `tx_per_second` float UNSIGNED NOT NULL,
  `vbytes_per_second` int(10) UNSIGNED NOT NULL,
  `mempool_byte_weight` int(10) UNSIGNED NOT NULL,
  `fee_data` longtext NOT NULL,
  `total_fee` double UNSIGNED NOT NULL,
  `vsize_1` int(11) NOT NULL,
  `vsize_2` int(11) NOT NULL,
  `vsize_3` int(11) NOT NULL,
  `vsize_4` int(11) NOT NULL,
  `vsize_5` int(11) NOT NULL,
  `vsize_6` int(11) NOT NULL,
  `vsize_8` int(11) NOT NULL,
  `vsize_10` int(11) NOT NULL,
  `vsize_12` int(11) NOT NULL,
  `vsize_15` int(11) NOT NULL,
  `vsize_20` int(11) NOT NULL,
  `vsize_30` int(11) NOT NULL,
  `vsize_40` int(11) NOT NULL,
  `vsize_50` int(11) NOT NULL,
  `vsize_60` int(11) NOT NULL,
  `vsize_70` int(11) NOT NULL,
  `vsize_80` int(11) NOT NULL,
  `vsize_90` int(11) NOT NULL,
  `vsize_100` int(11) NOT NULL,
  `vsize_125` int(11) NOT NULL,
  `vsize_150` int(11) NOT NULL,
  `vsize_175` int(11) NOT NULL,
  `vsize_200` int(11) NOT NULL,
  `vsize_250` int(11) NOT NULL,
  `vsize_300` int(11) NOT NULL,
  `vsize_350` int(11) NOT NULL,
  `vsize_400` int(11) NOT NULL,
  `vsize_500` int(11) NOT NULL,
  `vsize_600` int(11) NOT NULL,
  `vsize_700` int(11) NOT NULL,
  `vsize_800` int(11) NOT NULL,
  `vsize_900` int(11) NOT NULL,
  `vsize_1000` int(11) NOT NULL,
  `vsize_1200` int(11) NOT NULL,
  `vsize_1400` int(11) NOT NULL,
  `vsize_1600` int(11) NOT NULL,
  `vsize_1800` int(11) NOT NULL,
  `vsize_2000` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `transactions` (
  `blockheight` int(11) NOT NULL,
  `txid` varchar(65) NOT NULL,
  `fee` double NOT NULL,
  `feePerVsize` double NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


ALTER TABLE `blocks`
  ADD PRIMARY KEY (`height`);

ALTER TABLE `statistics`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `transactions`
  ADD PRIMARY KEY (`txid`),
  ADD KEY `blockheight` (`blockheight`);


ALTER TABLE `statistics`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
