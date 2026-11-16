// Pantone 年度代表色库（2000–2025）。数据来源：Pantone 潘通中国官网 pantonecn.com/articles/color-of-the-year。
// hex 为 sRGB 近似换算（非官方屏幕值），用于界面取色；Pantone 色号为官方编号。
// 2016（Rose Quartz + Serenity）与 2021（Ultimate Gray + Illuminating）为双年度色，全部收录。
// 如后续年份（2026 起）发布，按对象结构追加即可。
export interface PantoneColor {
  year: number;
  name: string;       // 中文名
  nameEn: string;     // 英文名
  pantone: string;    // 官方 Pantone 色号
  hex: string;        // sRGB 近似换算
  approx: true;
}

export const pantoneColors: PantoneColor[] = [
  { year: 2000, name: '蔚蓝', nameEn: 'Cerulean', pantone: '15-4020', hex: '#9BB7D4', approx: true },
  { year: 2001, name: '桃红玫瑰', nameEn: 'Fuchsia Rose', pantone: '17-2031', hex: '#C74375', approx: true },
  { year: 2002, name: '真爱红', nameEn: 'True Red', pantone: '19-1664', hex: '#BF1932', approx: true },
  { year: 2003, name: '水色天空', nameEn: 'Aqua Sky', pantone: '14-4811', hex: '#7BC4C4', approx: true },
  { year: 2004, name: '虎皮百合', nameEn: 'Tigerlily', pantone: '17-1456', hex: '#E2583E', approx: true },
  { year: 2005, name: '蓝绿松石', nameEn: 'Blue Turquoise', pantone: '15-5217', hex: '#53B0AE', approx: true },
  { year: 2006, name: '沙色海胆', nameEn: 'Sand Dollar', pantone: '13-1106', hex: '#DECDBE', approx: true },
  { year: 2007, name: '辣椒红', nameEn: 'Chili Pepper', pantone: '19-1557', hex: '#9B1B30', approx: true },
  { year: 2008, name: '蓝鸢尾', nameEn: 'Blue Iris', pantone: '18-3943', hex: '#5A5B9F', approx: true },
  { year: 2009, name: '含羞草黄', nameEn: 'Mimosa', pantone: '14-0848', hex: '#F0C05A', approx: true },
  { year: 2010, name: '绿松石', nameEn: 'Turquoise', pantone: '15-5519', hex: '#45B8AC', approx: true },
  { year: 2011, name: '忍冬花', nameEn: 'Honeysuckle', pantone: '18-2120', hex: '#D94F70', approx: true },
  { year: 2012, name: '探戈橘', nameEn: 'Tangerine Tango', pantone: '17-1463', hex: '#DD4124', approx: true },
  { year: 2013, name: '翡翠绿', nameEn: 'Emerald', pantone: '17-5641', hex: '#009B77', approx: true },
  { year: 2014, name: '兰花紫', nameEn: 'Radiant Orchid', pantone: '18-3224', hex: '#B163A3', approx: true },
  { year: 2015, name: '玛萨拉酒红', nameEn: 'Marsala', pantone: '18-1438', hex: '#955251', approx: true },
  { year: 2016, name: '玫瑰石英', nameEn: 'Rose Quartz', pantone: '13-1520', hex: '#F7CAC9', approx: true },
  { year: 2016, name: '宁静蓝', nameEn: 'Serenity', pantone: '15-3919', hex: '#92A8D1', approx: true },
  { year: 2017, name: '草木绿', nameEn: 'Greenery', pantone: '15-0343', hex: '#88B04B', approx: true },
  { year: 2018, name: '紫外光', nameEn: 'Ultra Violet', pantone: '18-3838', hex: '#5F4B8B', approx: true },
  { year: 2019, name: '活珊瑚橘', nameEn: 'Living Coral', pantone: '16-1546', hex: '#FF6F61', approx: true },
  { year: 2020, name: '经典蓝', nameEn: 'Classic Blue', pantone: '19-4052', hex: '#0F4C81', approx: true },
  { year: 2021, name: '极致灰', nameEn: 'Ultimate Gray', pantone: '17-5104', hex: '#939597', approx: true },
  { year: 2021, name: '亮丽黄', nameEn: 'Illuminating', pantone: '13-0647', hex: '#F5DF4D', approx: true },
  { year: 2022, name: '长春花蓝', nameEn: 'Very Peri', pantone: '17-3938', hex: '#6667AB', approx: true },
  { year: 2023, name: '洋红万岁', nameEn: 'Viva Magenta', pantone: '18-1750', hex: '#BB2649', approx: true },
  { year: 2024, name: '柔和桃', nameEn: 'Peach Fuzz', pantone: '13-1023', hex: '#FFBE98', approx: true },
  { year: 2025, name: '摩卡慕斯', nameEn: 'Mocha Mousse', pantone: '17-1230', hex: '#A47864', approx: true }
];
