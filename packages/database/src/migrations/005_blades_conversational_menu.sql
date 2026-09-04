-- Enrich Blades Hair salon facts for a friendlier Sophie conversation
-- (layered cuts, weekday timetable phrasing, clearer service menu).
UPDATE clients
SET config = config
  || jsonb_build_object(
    'hours', 'We''re open weekdays ten till seven — Monday to Friday, 10:00am–7:00pm. Closed Saturday and Sunday unless the team confirms otherwise.',
    'prices', 'All prices are FROM prices. Ladies: shampoo cut & finish from £68; layered cut or restyle priced at consultation (book a short visit first); blow dry short/medium/long from £39/£44/£49; highlights full/half/T-section from £135/£115/£100; colour full head/regrowth from £95/£66. Gents: shampoo cut & finish from £40; shampoo & clipper from £30; clipper cut from £28; cut & beard from £57; beard trim from £20; cut & colour from £80; colour from £50; reshade from £45. Hair up and colour correction are priced at consultation.',
    'services', '[
      {"slug":"15min","title":"Consultation / layered cut or restyle enquiry","durationMinutes":15},
      {"slug":"30min","title":"Ladies shampoo cut & finish","durationMinutes":30},
      {"slug":"30min","title":"Blow dry","durationMinutes":30},
      {"slug":"30min","title":"Highlights or colour","durationMinutes":30},
      {"slug":"30min","title":"Gents cut / clipper / beard","durationMinutes":30}
    ]'::jsonb,
    'policies', '[
      "Never invent availability; only offer slots from check_availability.",
      "Always say FROM before any price. Never quote a price as the exact final cost.",
      "Layered cuts and restyles are consultation-priced — offer a short visit (15min) first, never invent a fixed layered-cut price.",
      "Colour and highlights only with Galyna, Jana, or Denise. Never promise a named stylist is free.",
      "Confirm service, day/time, from-price, name and mobile before locking a booking. Email is optional.",
      "State the FROM price and wait for agreement before collecting final booking details.",
      "Never transfer to finish a booking. Book it yourself; transfer only if they insist on a person after you offered to book."
    ]'::jsonb,
    'publishedFacts', '[
      "Blades Hair is a barbering and hairdressing salon for men and women in the City of London.",
      "Address: 8 Cullum Street, London, EC3M 7JJ.",
      "Phones: 020 7623 1994 or 020 7929 6680.",
      "Timetable: open Monday to Friday 10:00am–7:00pm. Speak it naturally as weekdays ten till seven. Do not assume Saturday or Sunday opening.",
      "Online booking is available 24/7 with email confirmation and a reminder two hours before.",
      "All men''s treatments finish with a refreshing hot towel for the face and neck, included.",
      "Colour and highlights are with Galyna, Jana or Denise. Cuts, clipper cuts, beard trims and blow-dries can be with any of the team.",
      "Layered cuts and restyles start with a short consultation; the stylist confirms the final price in person — never invent a layered-cut price.",
      "The team: Galyna, Cristina, Jana, Daiva, Denise, Stacey and Laima."
    ]'::jsonb,
    'unknownTopics', '["weekend opening","add-on treatments and extras prices","named stylist live availability","exact layered-cut final price"]'::jsonb
  )
WHERE id = 'client_blades_hair';
