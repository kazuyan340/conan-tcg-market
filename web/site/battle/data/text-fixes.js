// cards-data.js(自動生成)の効果文に残っている誤記を、読み込み時に補正する。
// cards-data.js は card_data_lib/build_app_data.py で再生成されて直接編集できないため、別ファイルで補正する。
(function () {
  var data = window.CARD_DATA || [];
  var fixes = [
    // [カードid, 誤記, 正しい表記]
    [1344, '【解決編⁆', '【解決編】'],          // ジョディ・スターリング
    [1482, '【登場時⁆', '【登場時】'],          // 鬼丸猛
    [896, '⁅白⁆', '【白】'],                    // 黒羽盗一
    [896, '⁅', '【'],
    [896, '⁆', '】'],
    [1672, '【解決編】自分ターン中】', '【解決編】【自分ターン中】'], // 毛利小五郎
    [1026, 'レべル', 'レベル'],
    [1424, '【ヒラメキ】証拠からリムーブされるときに発動する）', '【ヒラメキ】（証拠からリムーブされるときに発動する）'],
    [872, '<br>', '\n'],
    [895, '<br>', '\n'],
    [921, '<br>', '\n'],
  ];
  fixes.forEach(function (f) {
    var c = data.find(function (x) { return x.id === f[0]; });
    if (c && c.ability_text && c.ability_text.indexOf(f[1]) !== -1) {
      c.ability_text = c.ability_text.split(f[1]).join(f[2]);
    }
  });
})();
