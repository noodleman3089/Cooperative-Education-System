-- Master Data Seeds for Online Cooperative Education Management System

-- 1. Populating Faculty Data
INSERT INTO master_faculty (faculty_name_th) VALUES
('คณะวิทยาศาสตร์'),
('คณะวิศวกรรมศาสตร์'),
('คณะบริหารธุรกิจ'),
('คณะศิลปศาสตร์')
ON CONFLICT (faculty_name_th) DO NOTHING;

-- 2. Populating Major Data (linked to Faculty)
INSERT INTO master_major (faculty_id, major_code, major_name_th) VALUES
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะวิทยาศาสตร์'), 'CS01', 'สาขาวิชาวิทยาการคอมพิวเตอร์'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะวิทยาศาสตร์'), 'IT01', 'สาขาวิชาเทคโนโลยีสารสนเทศ'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะวิศวกรรมศาสตร์'), 'CPE01', 'สาขาวิชาวิศวกรรมคอมพิวเตอร์'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'IS01', 'สาขาวิชาระบบสารสนเทศ'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'MGT01', 'สาขาวิชาการจัดการ'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'MKT01', 'สาขาวิชาการตลาด'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'ACC01', 'สาขาวิชาการบัญชี'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะวิทยาศาสตร์'), 'MM01', 'สาขาวิชามัลติมีเดีย'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะศิลปศาสตร์'), 'PR01', 'สาขาวิชาโฆษณาและประชาสัมพันธ์'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'LOG01', 'สาขาวิชาโลจิสติกส์และการจัดการระบบขนส่ง'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'ECO01', 'สาขาวิชาเศรษฐศาสตร์'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'DIB01', 'สาขาวิชานวัตกรรมและธุรกิจดิจิทัล'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะศิลปศาสตร์'), 'LANG01', 'สาขาวิชาภาษา'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะศิลปศาสตร์'), 'GEN01', 'สาขาวิชาศึกษาทั่วไป'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'TH01', 'สาขาวิชาการท่องเที่ยวและการโรงแรม'),
((SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจ'), 'SM01', 'สาขาวิชาการจัดการการกีฬา')
ON CONFLICT (major_code) DO NOTHING;

-- 3. Populating Province Data
INSERT INTO master_province (province_name_th) VALUES
('กรุงเทพมหานคร'),
('นนทบุรี'),
('ปทุมธานี'),
('สมุทรปราการ'),
('ชลบุรี'),
('เชียงใหม่'),
('ขอนแก่น'),
('นครราชสีมา'),
('สงขลา'),
('ภูเก็ต')
ON CONFLICT (province_name_th) DO NOTHING;

-- 4. Populating Coop Semester Data
INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES
(2569, '1', TRUE),
(2569, '2', FALSE);

